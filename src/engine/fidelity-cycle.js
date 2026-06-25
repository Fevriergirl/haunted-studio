// Fidelity adjudication orchestration over a completed cycle.
//
// This drives the standalone fidelity-adjudication pipeline against a real
// studio ledger, with role isolation:
//
//   * the commitment is frozen from the cycle's locked intention;
//   * the artifact description is the BLIND WITNESS output (post-result
//     evidence), so independent detection never reads the maker's claims;
//   * the maker self-report comes from the creator provider;
//   * detection is a deterministic function over the independent witness — the
//     detector has no provider and cannot be argued with;
//   * adjudication comes from a separate adversarial-reviewer provider.
//
// It persists the five post-cycle fidelity events and is resumable: every step
// reuses an already-persisted result instead of recomputing it.

import { operationScopePath, serializeOperation } from '../core/operations.js';
import {
  adjudicate,
  deriveAdjudication,
  detectSignals,
  freezeIntention,
  makerSelfReport,
  raisePossibleViolations
} from './fidelity-adjudication.js';
import {
  fidelityAdjudicatedEvent,
  fidelityIntentionFrozenEvent,
  fidelityMakerReportedEvent,
  fidelityRecordsFromEvents,
  fidelitySignalsDetectedEvent,
  fidelityViolationsAllegedEvent
} from './fidelity-ledger.js';

export function commitmentFromIntention(intention = {}) {
  // Accept both plain-string commitment items and structured { term } items so
  // a structured intention is not silently dropped into an empty commitment
  // (which would read as "no required features" — absence masquerading as
  // compliance at the boundary).
  const toItems = (value, prefix) => (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object' && typeof entry.term === 'string') return entry.term.trim();
      return '';
    })
    .filter((term) => term.length > 0)
    .map((term, index) => ({ id: `${prefix}_${index}`, term }));
  return {
    must_include: toItems(intention.must_include, 'inc'),
    must_avoid: toItems(intention.must_avoid, 'avoid')
  };
}

// The witness is field-less prose, so detection runs over a single
// `witness` field; field-displacement detection is therefore unavailable until
// a field-structured inspection exists (a later increment).
function artifactDescriptionFromWitness(witness) {
  const text = (witness.observations ?? [])
    .map((observation) => `${observation.description ?? ''} ${observation.observable_support ?? ''}`)
    .join(' \n ');
  return { basis: 'artifact_description', fields: { witness: text } };
}

export async function runFidelityAdjudication(options) {
  return serializeOperation(
    `studio-write:${operationScopePath(options.studio.rootDir)}`,
    () => runFidelityAdjudicationUnlocked(options)
  );
}

async function runFidelityAdjudicationUnlocked({ studio, cycleId, provider, roleProviders = {} }) {
  const maker = roleProviders.creator ?? provider;
  const reviewer = roleProviders.fidelityReviewer ?? provider;
  if (maker?.supportsFidelityAdjudication !== true || typeof maker.reportFidelity !== 'function') {
    throw new Error('A maker provider with fidelity self-report support is required.');
  }
  if (reviewer?.supportsFidelityAdjudication !== true || typeof reviewer.adjudicateFidelity !== 'function') {
    throw new Error('An adversarial fidelity reviewer provider is required.');
  }

  let events = await studio.ledger.readAll();
  if (!events.some((event) => event.type === 'cycle_completed' && event.cycle_id === cycleId)) {
    throw new Error(`Fidelity adjudication requires a completed cycle; ${cycleId} is not completed.`);
  }
  const lockEvent = events.find((event) => event.type === 'intention_locked' && event.cycle_id === cycleId);
  if (!lockEvent) throw new Error(`Cycle ${cycleId} has no locked intention to freeze.`);
  const witness = events.find((event) => event.type === 'artifact_witnessed' && event.cycle_id === cycleId)?.payload;
  if (!witness) {
    return { cycleId, status: 'unavailable', reason: 'no_blind_witness', adjudication: null };
  }

  // The intention_locked payload nests the rich commitment (must_include /
  // must_avoid) under `.intention`.
  const intention = lockEvent.payload.intention ?? lockEvent.payload;
  const commitment = commitmentFromIntention(intention);

  // Honest provenance: the adversarial reviewer can only count as independent
  // if it is a different provider than the maker. Offline runs legitimately use
  // one provider for every role, so this is recorded rather than forbidden — a
  // confirmed verdict from a non-isolated reviewer is self-adjudication.
  const reviewerIndependent = reviewer !== maker;

  const fidelityEvents = () => events.filter((event) => event.cycle_id === cycleId && typeof event.type === 'string' && event.type.startsWith('fidelity_'));
  const firstFidelity = (type) => fidelityEvents().find((event) => event.type === type);
  let appended = false;
  const append = async (spec) => {
    const event = await studio.ledger.append({ ...spec, cycleId });
    events.push(event);
    appended = true;
    return event;
  };

  let frozen = firstFidelity('fidelity_intention_frozen')?.payload;
  if (!frozen) {
    frozen = freezeIntention(commitment, { sourceEventId: lockEvent.event_id });
    await append(fidelityIntentionFrozenEvent(frozen, cycleId));
  }

  let report = firstFidelity('fidelity_maker_reported')?.payload;
  if (!report) {
    const reported = await maker.reportFidelity({ lockedIntention: intention, commitment, constitution: studio.constitution });
    report = makerSelfReport(frozen, {
      honored: reported.honored === true,
      disclosedDeviations: reported.disclosed_deviations ?? [],
      statement: reported.statement ?? ''
    });
    await append(fidelityMakerReportedEvent(report, cycleId));
  }

  let signals = firstFidelity('fidelity_signals_detected')?.payload?.signals;
  if (!signals) {
    signals = detectSignals(frozen, artifactDescriptionFromWitness(witness));
    await append(fidelitySignalsDetectedEvent(signals, cycleId, frozen));
  }

  let possible = firstFidelity('fidelity_violation_alleged')?.payload?.possible_violations;
  if (!possible) {
    possible = raisePossibleViolations(frozen, signals, report);
    if (possible.length > 0) await append(fidelityViolationsAllegedEvent(possible, cycleId, frozen));
  }

  const alreadyAdjudicated = new Set(fidelityEvents()
    .filter((event) => event.type === 'fidelity_adjudicated')
    .map((event) => event.payload.possible_violation_id));
  for (const violation of possible) {
    if (alreadyAdjudicated.has(violation.record_id)) continue;
    const decision = await reviewer.adjudicateFidelity({ frozen, possibleViolation: violation, witness, lockedIntention: intention });
    const verdict = adjudicate(violation, {
      verdict: decision.verdict,
      challenges: decision.challenges ?? [],
      // The reviewer cannot fake its own independence, so the orchestration
      // stamps the objective fact onto the persisted finding.
      findings: { ...(decision.findings ?? {}), reviewer_independent_of_maker: reviewerIndependent },
      confidence: decision.confidence ?? 0
    });
    await append(fidelityAdjudicatedEvent(verdict, cycleId));
  }

  if (appended) await studio.projectAndSave('fidelity_adjudicated');
  return {
    cycleId,
    status: 'available',
    role_isolated: reviewerIndependent,
    adjudication: deriveAdjudication(fidelityRecordsFromEvents(events, cycleId))
  };
}
