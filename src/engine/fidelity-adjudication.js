// Fidelity adjudication (research slice).
//
// This module models the append-only adjudication of whether a finished work
// honored its frozen creative commitment. It is deliberately standalone: it
// does not yet write to the studio ledger or touch the live creative cycle.
// The pipeline is:
//
//   frozen intention
//     -> maker self-report
//     -> independent signal detection
//     -> possible violation
//     -> adversarial challenge
//     -> { confirmed | rejected | unresolved | undetectable }
//
// Invariants enforced here (see docs/FIDELITY-ADJUDICATION-DESIGN.md):
//   * the maker cannot erase independent evidence;
//   * the detector cannot convict by itself;
//   * disagreement is preserved in the append-only record list;
//   * absence of a signal is never proof of compliance;
//   * artifact-description evidence is labeled honestly and is never silently
//     promoted to a pixel-level claim;
//   * artistic transgression cannot retroactively rewrite the commitment.

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical-json.js';
import { id } from '../core/ids.js';

export const VERDICTS = new Set(['confirmed', 'rejected', 'unresolved', 'undetectable']);
export const EVIDENCE_BASES = new Set(['artifact_description', 'pixel_inspection', 'maker_report']);

// Signal types that allege a potential breach (they raise a possible violation).
// `ambiguous_presence` exists because a clean substring match is not proof of
// presence: rhetorical or counterfactual framing ("a red circle? hardly",
// "where a red circle should be, there is nothing") matches the term yet
// describes its absence. Rather than silently affirm — which would close the
// pipeline before any adversarial review — the detector escalates the doubt to
// a challengeable allegation. Escalation is the safe direction.
const BREACH_SIGNALS = new Set(['omission', 'negated_presence', 'quoted_requirement', 'field_displacement', 'prohibited_presence', 'ambiguous_presence']);
// Signal types that are explicitly NOT breaches (recorded for honesty/audit).
const NON_BREACH_SIGNALS = new Set(['affirmed_presence', 'affirmed_avoidance', 'synonym_presence', 'quoted_prohibition', 'no_prohibited_signal']);

const NEGATION_WORDS = ['not', 'no', 'without', 'never', 'excludes', 'omits', 'lacks', 'absent', 'missing', 'fails to', 'failed to', 'instead of'];
// Markers that a clean term match sits inside a doubtful, rhetorical, or
// counterfactual frame — i.e. the term is named but its presence is in question.
const DOUBT_MARKERS = ['?', 'hardly', 'barely', 'should be', 'supposed to', 'meant to be', 'would have', 'no longer', 'instead of', 'rather than', 'nothing', 'is absent', 'is missing', 'where a', 'if only', 'fails to', 'never quite'];
const ATTRIBUTION_PHRASES = ['the brief', 'the intention', 'the commitment', 'the plan', 'was asked', 'were asked', 'required', 'instructed', 'supposed to', 'meant to', 'requirement', 'requested', 'specified', 'called for'];

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function commitmentHash(fields) {
  return `commit_${createHash('sha256').update(canonicalize(fields)).digest('hex').slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// Stage 1: frozen intention. Immutable; its hash is the identity every later
// record must carry. A later "transgression" references it but can never edit
// it, so the original commitment cannot be rewritten after the fact.
// ---------------------------------------------------------------------------
export function freezeIntention(fields, { sourceEventId = null } = {}) {
  requireObject(fields, 'frozen intention fields');
  const frozenFields = deepFreeze(structuredClone(fields));
  return Object.freeze({
    kind: 'frozen_intention',
    record_id: id('frozen'),
    commitment_hash: commitmentHash(frozenFields),
    fields: frozenFields,
    source_event_id: sourceEventId,
    frozen_at: new Date().toISOString()
  });
}

function assertSameCommitment(frozen, suppliedHash, label) {
  if (suppliedHash !== frozen.commitment_hash) {
    throw new Error(`${label} references a different commitment than the frozen intention; the original commitment cannot be rewritten.`);
  }
}

// The four preparatory fidelity/provenance fields every downstream record
// carries. Re-created here from first principles, not copied from prior work.
function provenance(frozen, { evidenceBasis, signalAuthority, disclosureStatus }) {
  if (!EVIDENCE_BASES.has(evidenceBasis)) throw new Error(`Unknown evidence basis: ${evidenceBasis}.`);
  return {
    commitment_hash: frozen.commitment_hash,        // (1) frozen-commitment identity
    evidence_basis: evidenceBasis,                  // (2) where the evidence came from
    signal_authority: signalAuthority,              // (3) how much weight it may carry
    disclosure_status: disclosureStatus             // (4) disclosed vs concealed
  };
}

// ---------------------------------------------------------------------------
// Stage 2: maker self-report. One input among several; it can never delete or
// outrank independent evidence.
// ---------------------------------------------------------------------------
export function makerSelfReport(frozen, { honored, disclosedDeviations = [], statement = '', commitmentHash: suppliedHash = frozen.commitment_hash } = {}) {
  assertSameCommitment(frozen, suppliedHash, 'maker self-report');
  if (typeof honored !== 'boolean') throw new Error('maker self-report must state honored as a boolean.');
  if (!Array.isArray(disclosedDeviations)) throw new Error('maker self-report disclosedDeviations must be an array.');
  return Object.freeze({
    kind: 'maker_self_report',
    record_id: id('maker'),
    frozen_intention_id: frozen.record_id,
    ...provenance(frozen, { evidenceBasis: 'maker_report', signalAuthority: 'self_report', disclosureStatus: honored ? 'claims_full_fidelity' : 'admits_deviation' }),
    honored,
    disclosed_deviations: disclosedDeviations.map((deviation) => ({
      target_item_id: deviation.target_item_id ?? null,
      target_field: deviation.target_field ?? null,
      description: String(deviation.description ?? '')
    })),
    statement: String(statement)
  });
}

// ---------------------------------------------------------------------------
// Stage 3: independent signal detection. Primitive text matching may only
// produce a signal; it never produces a verdict and never adjudicates itself.
// ---------------------------------------------------------------------------
function locate(text, term) {
  const haystack = String(text).toLowerCase();
  const needle = String(term).toLowerCase();
  const index = haystack.indexOf(needle);
  if (index === -1) return { present: false, negated: false, quoted: false };
  const before = haystack.slice(Math.max(0, index - 48), index);
  const negated = NEGATION_WORDS.some((word) => before.includes(word)) || before.includes("n't ") || before.includes("n't");
  const quotedByMark = /["'“‘”’]/.test(haystack.slice(Math.max(0, index - 1), index)) ||
    /["'“‘”’]/.test(haystack.slice(index + needle.length, index + needle.length + 1));
  const attributed = ATTRIBUTION_PHRASES.some((phrase) => before.includes(phrase));
  return { present: true, negated, quoted: quotedByMark || attributed };
}

function framedAsDoubtful(text, term) {
  const haystack = String(text).toLowerCase();
  const needle = String(term).toLowerCase();
  const index = haystack.indexOf(needle);
  if (index === -1) return false;
  const window = haystack.slice(Math.max(0, index - 24), Math.min(haystack.length, index + needle.length + 40));
  return DOUBT_MARKERS.some((marker) => window.includes(marker));
}

function cleanPresenceFields(artifactFields, term) {
  return Object.entries(artifactFields)
    .map(([field, text]) => [field, locate(text, term)])
    .filter(([, result]) => result.present && !result.negated && !result.quoted)
    .map(([field]) => field);
}

function anyPresence(artifactFields, term, predicate) {
  return Object.values(artifactFields).some((text) => {
    const result = locate(text, term);
    return result.present && predicate(result);
  });
}

function signal(frozen, { evidenceBasis, signalType, targetItemId, targetField, description, strength, pixelLevel }) {
  return Object.freeze({
    kind: 'independent_signal',
    record_id: id('signal'),
    frozen_intention_id: frozen.record_id,
    ...provenance(frozen, { evidenceBasis, signalAuthority: 'non_authoritative_signal', disclosureStatus: 'independent' }),
    signal_type: signalType,
    is_breach_signal: BREACH_SIGNALS.has(signalType),
    target_item_id: targetItemId ?? null,
    target_field: targetField ?? null,
    description,
    strength,
    pixel_level: Boolean(pixelLevel)
    // Note: there is deliberately no verdict field. A detector cannot convict.
  });
}

// artifact: { fields: { fieldName: text, ... }, basis: 'artifact_description' | 'pixel_inspection' }
export function detectSignals(frozen, artifact = {}) {
  const fields = requireObject(artifact.fields ?? {}, 'artifact.fields');
  const basis = artifact.basis ?? 'artifact_description';
  if (!EVIDENCE_BASES.has(basis) || basis === 'maker_report') throw new Error(`detectSignals requires an artifact evidence basis, got ${basis}.`);
  const commitment = frozen.fields ?? {};
  const signals = [];

  for (const item of commitment.must_include ?? []) {
    const clean = cleanPresenceFields(fields, item.term);
    const expected = item.expected_field ?? null;
    if (clean.length > 0 && (expected === null || clean.includes(expected))) {
      const matchField = expected ?? clean[0];
      if (framedAsDoubtful(fields[matchField], item.term)) {
        // The term matched, but its frame casts doubt on real presence. Do not
        // affirm and close the pipeline; raise a challengeable allegation.
        signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'ambiguous_presence', targetItemId: item.id, targetField: matchField, description: `"${item.term}" is named in ${matchField}, but the surrounding language casts doubt on whether it is actually present; escalating for review rather than affirming.`, strength: 0.55, pixelLevel: item.pixel_level }));
      } else {
        signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'affirmed_presence', targetItemId: item.id, targetField: matchField, description: `"${item.term}" appears as required.`, strength: 0.4, pixelLevel: item.pixel_level }));
      }
      continue;
    }
    if (clean.length > 0) {
      // Present, but not in the field the commitment asked for.
      signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'field_displacement', targetItemId: item.id, targetField: expected, description: `"${item.term}" appears in ${clean.join(', ')} but the commitment placed it in ${expected}.`, strength: 0.6, pixelLevel: item.pixel_level }));
      continue;
    }
    if (anyPresence(fields, item.term, (r) => r.negated)) {
      signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'negated_presence', targetItemId: item.id, targetField: expected, description: `"${item.term}" is described as absent or negated.`, strength: 0.7, pixelLevel: item.pixel_level }));
      continue;
    }
    if (anyPresence(fields, item.term, (r) => r.quoted)) {
      signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'quoted_requirement', targetItemId: item.id, targetField: expected, description: `"${item.term}" appears only as a restatement of the requirement, not as a realized feature.`, strength: 0.5, pixelLevel: item.pixel_level }));
      continue;
    }
    const synonym = (item.synonyms ?? []).find((alt) => cleanPresenceFields(fields, alt).length > 0);
    if (synonym) {
      signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'synonym_presence', targetItemId: item.id, targetField: expected, description: `"${item.term}" is absent but the near-synonym "${synonym}" is present; this is not evidence of a violation.`, strength: 0.3, pixelLevel: item.pixel_level }));
      continue;
    }
    signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'omission', targetItemId: item.id, targetField: expected, description: `No description signal for required "${item.term}".`, strength: 0.5, pixelLevel: item.pixel_level }));
  }

  for (const item of commitment.must_avoid ?? []) {
    const clean = cleanPresenceFields(fields, item.term);
    if (clean.length > 0) {
      signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'prohibited_presence', targetItemId: item.id, targetField: clean[0], description: `Prohibited "${item.term}" appears in ${clean.join(', ')}.`, strength: 0.7, pixelLevel: item.pixel_level }));
      continue;
    }
    if (anyPresence(fields, item.term, (r) => r.negated)) {
      signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'affirmed_avoidance', targetItemId: item.id, targetField: null, description: `Prohibited "${item.term}" is described as avoided.`, strength: 0.3, pixelLevel: item.pixel_level }));
      continue;
    }
    if (anyPresence(fields, item.term, (r) => r.quoted)) {
      signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'quoted_prohibition', targetItemId: item.id, targetField: null, description: `Prohibited "${item.term}" appears only as a restatement of the rule.`, strength: 0.2, pixelLevel: item.pixel_level }));
      continue;
    }
    // Absence of the prohibited term is recorded honestly as "no signal",
    // NOT as confirmed compliance.
    signals.push(signal(frozen, { evidenceBasis: basis, signalType: 'no_prohibited_signal', targetItemId: item.id, targetField: null, description: `No description signal for prohibited "${item.term}"; absence is not proof of compliance.`, strength: 0, pixelLevel: item.pixel_level }));
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Stage 4: possible violations. Allegations only — status is always "alleged".
// ---------------------------------------------------------------------------
function disclosureFor(makerReport, signalRecord) {
  if (!makerReport || makerReport.honored !== false) return 'undisclosed';
  const disclosed = (makerReport.disclosed_deviations ?? []).some((deviation) =>
    (deviation.target_item_id && deviation.target_item_id === signalRecord.target_item_id) ||
    (deviation.target_field && deviation.target_field === signalRecord.target_field));
  return disclosed ? 'disclosed' : 'undisclosed';
}

export function raisePossibleViolations(frozen, signals, makerReport = null) {
  return signals
    .filter((signalRecord) => signalRecord.is_breach_signal)
    .map((signalRecord) => {
      const disclosureStatus = disclosureFor(makerReport, signalRecord);
      return Object.freeze({
        kind: 'possible_violation',
        record_id: id('possible'),
        frozen_intention_id: frozen.record_id,
        ...provenance(frozen, { evidenceBasis: signalRecord.evidence_basis, signalAuthority: 'alleged', disclosureStatus }),
        basis_signal_ids: [signalRecord.record_id],
        target_item_id: signalRecord.target_item_id,
        target_field: signalRecord.target_field,
        pixel_level: signalRecord.pixel_level,
        alleged_breach: signalRecord.signal_type,
        description: signalRecord.description,
        status: 'alleged' // never "confirmed": a possible violation cannot confirm itself
      });
    });
}

// ---------------------------------------------------------------------------
// Stage 5/6: adversarial challenge -> verdict. The ONLY stage that may reach a
// verdict, and the only place an artifact-description claim can be honestly
// capped below a pixel-level conviction.
// ---------------------------------------------------------------------------
export function adjudicate(possibleViolation, { verdict, challenges = [], findings = {}, confidence = 0 } = {}) {
  if (possibleViolation?.kind !== 'possible_violation') throw new Error('adjudicate requires a possible_violation record.');
  if (!VERDICTS.has(verdict)) throw new Error(`adjudicate requires a verdict in {${[...VERDICTS].join(', ')}}.`);
  const realChallenges = (Array.isArray(challenges) ? challenges : []).filter((value) => typeof value === 'string' && value.trim());
  if (verdict === 'confirmed' && realChallenges.length === 0) {
    throw new Error('A confirmed verdict requires at least one adversarial challenge.');
  }
  // Pixel-level honesty: an artifact-description allegation can never be
  // confirmed as a pixel-level fact. It must wait for real image inspection.
  if (verdict === 'confirmed' && possibleViolation.pixel_level && possibleViolation.evidence_basis !== 'pixel_inspection') {
    throw new Error('A pixel-level violation cannot be confirmed from artifact-description evidence; use "unresolved" or "undetectable" until the image is inspected.');
  }
  const numericConfidence = Number(confidence);
  if (!Number.isFinite(numericConfidence) || numericConfidence < 0 || numericConfidence > 1) throw new Error('adjudicate confidence must be between 0 and 1.');
  if (verdict === 'confirmed' && numericConfidence <= 0) throw new Error('A confirmed verdict requires positive confidence.');
  return Object.freeze({
    kind: 'adversarial_challenge',
    record_id: id('verdict'),
    frozen_intention_id: possibleViolation.frozen_intention_id,
    commitment_hash: possibleViolation.commitment_hash,
    possible_violation_id: possibleViolation.record_id,
    evidence_basis: possibleViolation.evidence_basis,
    disclosure_status: possibleViolation.disclosure_status,
    pixel_level: possibleViolation.pixel_level,
    target_item_id: possibleViolation.target_item_id,
    target_field: possibleViolation.target_field,
    verdict,
    challenges: realChallenges.length ? realChallenges : ['No adversarial challenge recorded.'],
    findings,
    confidence: numericConfidence
  });
}

// ---------------------------------------------------------------------------
// Append-only ledger helpers + derived state. There is no delete: the maker
// cannot erase independent evidence, and disagreement is preserved.
// ---------------------------------------------------------------------------
export function appendRecord(ledger, record) {
  return Object.freeze([...ledger, record]);
}

export function deriveAdjudication(records) {
  const frozenIntentions = records.filter((record) => record.kind === 'frozen_intention');
  const makerReports = records.filter((record) => record.kind === 'maker_self_report');
  const signals = records.filter((record) => record.kind === 'independent_signal');
  const possibleViolations = records.filter((record) => record.kind === 'possible_violation');
  const verdicts = records.filter((record) => record.kind === 'adversarial_challenge');

  const verdictByViolation = new Map(verdicts.map((verdict) => [verdict.possible_violation_id, verdict]));
  const breachSignals = signals.filter((signalRecord) => signalRecord.is_breach_signal);

  // Disagreement: the maker claims full fidelity, yet independent breach
  // signals exist. Both are retained; neither side erases the other.
  const makerClaimsFidelity = makerReports.some((report) => report.honored === true);
  const disagreements = makerClaimsFidelity
    ? breachSignals.map((signalRecord) => ({ signal_id: signalRecord.record_id, target_item_id: signalRecord.target_item_id, note: 'Maker claimed fidelity but an independent breach signal exists.' }))
    : [];

  const confirmed = verdicts.filter((verdict) => verdict.verdict === 'confirmed');
  const concealedConfirmed = confirmed.filter((verdict) => verdict.disclosure_status === 'undisclosed');
  const disclosedConfirmed = confirmed.filter((verdict) => verdict.disclosure_status === 'disclosed');
  const adjudicatedIds = new Set(verdicts.map((verdict) => verdict.possible_violation_id));
  const unadjudicated = possibleViolations.filter((violation) => !adjudicatedIds.has(violation.record_id));

  let status;
  if (concealedConfirmed.length > 0) status = 'concealed_deviation_confirmed';
  else if (disclosedConfirmed.length > 0) status = 'disclosed_transgression_confirmed';
  else if (unadjudicated.length > 0) status = 'contested_unadjudicated';
  else if (possibleViolations.length > 0) status = 'alleged_then_rejected_or_unresolved';
  else if (breachSignals.length > 0) status = 'signals_without_allegation';
  else if (signals.length > 0) status = 'no_breach_signal'; // explicitly NOT "compliant"
  else status = 'no_signal'; // absence is not proof of compliance

  return {
    commitment_hashes: [...new Set(frozenIntentions.map((record) => record.commitment_hash))],
    status,
    compliant: false, // never asserted from this module; only breaches can be confirmed
    maker_claims_fidelity: makerClaimsFidelity,
    disagreements,
    signal_count: signals.length,
    breach_signal_count: breachSignals.length,
    possible_violation_count: possibleViolations.length,
    unadjudicated_possible_violations: unadjudicated.map((violation) => violation.record_id),
    confirmed_concealed: concealedConfirmed.map((verdict) => verdict.record_id),
    confirmed_disclosed: disclosedConfirmed.map((verdict) => verdict.record_id),
    verdicts: verdicts.map((verdict) => ({ possible_violation_id: verdict.possible_violation_id, verdict: verdict.verdict, disclosure_status: verdict.disclosure_status, evidence_basis: verdict.evidence_basis })),
    verdict_by_violation: verdictByViolation
  };
}

// ---------------------------------------------------------------------------
// Curator canon-threshold correction (re-created from first principles).
//
// Prior behavior promoted to canon on audit score alone, and used a strict
// comparison that wrongly rejected a work scoring exactly at the threshold.
// Corrected rules:
//   * the boundary is inclusive (score >= threshold);
//   * a confirmed concealed deviation blocks canon regardless of score;
//   * an unresolved/undetectable fidelity finding downgrades a passing score to
//     "needs fidelity review" rather than silently passing.
// ---------------------------------------------------------------------------
export function canonEligibility({ auditScore, threshold, fidelityVerdicts = [] }) {
  const score = Number(auditScore);
  const bar = Number(threshold);
  if (!Number.isFinite(score) || !Number.isFinite(bar)) {
    return { eligible: false, status: 'undetermined', reason: 'Audit score or threshold is not numeric.' };
  }
  if (fidelityVerdicts.some((verdict) => verdict.verdict === 'confirmed' && verdict.disclosure_status === 'undisclosed')) {
    return { eligible: false, status: 'concept_blocked_concealed_deviation', reason: 'A confirmed concealed deviation blocks canon promotion.' };
  }
  if (score < bar) {
    return { eligible: false, status: 'below_threshold', reason: 'Audit score is below the canon threshold.' };
  }
  if (fidelityVerdicts.some((verdict) => verdict.verdict === 'unresolved' || verdict.verdict === 'undetectable')) {
    return { eligible: false, status: 'needs_fidelity_review', reason: 'Audit score meets the threshold but a fidelity finding is unresolved.' };
  }
  return { eligible: true, status: 'canon_eligible', reason: 'Audit score meets the inclusive threshold and no fidelity finding blocks canon.' };
}
