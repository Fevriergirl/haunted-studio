import { createHash } from 'node:crypto';
import { canonicalize } from './canonical-json.js';

export const CURRENT_EVENT_SCHEMA_VERSION = 1;
export const LEGACY_EVENT_SCHEMA_VERSION = 0;

export const CYCLE_TERMINAL_TYPES = new Set(['cycle_completed', 'cycle_failed']);

export const POST_CYCLE_EVENT_TYPES = new Set([
  'human_review_recorded',
  'mailbox_observations_consumed',
  'memory_corrected'
]);

const GLOBAL_EVENT_TYPES = new Set([
  'studio_initialized',
  'studio_forked',
  'mailbox_message_received'
]);

const CYCLE_EVENT_TYPES = new Set([
  'cycle_started',
  'observation_selected',
  'intention_locked',
  'candidates_generated',
  'critics_reported',
  'curation_decided',
  'curation_overridden_by_condition',
  'candidate_revised',
  'revision_critiqued',
  'artifact_generated',
  'artifact_witnessed',
  'artifact_deviations_compared',
  'surprise_reviewed',
  'post_result_evidence_unavailable',
  'artifact_audited',
  'artifact_audit_not_passed',
  'audience_predicted',
  'memory_consolidated',
  ...CYCLE_TERMINAL_TYPES
]);

export const LEDGER_EVENT_TYPES = new Set([
  ...GLOBAL_EVENT_TYPES,
  ...CYCLE_EVENT_TYPES,
  ...POST_CYCLE_EVENT_TYPES
]);

const ALLOWED_NEXT_CYCLE_EVENTS = new Map([
  ['cycle_started', new Set(['observation_selected'])],
  ['observation_selected', new Set(['intention_locked'])],
  ['intention_locked', new Set(['candidates_generated'])],
  ['candidates_generated', new Set(['critics_reported'])],
  ['critics_reported', new Set(['curation_decided'])],
  ['curation_overridden_by_condition', new Set([
    'artifact_generated',
    'post_result_evidence_unavailable'
  ])],
  ['candidate_revised', new Set(['revision_critiqued'])],
  ['revision_critiqued', new Set(['curation_decided'])],
  ['artifact_generated', new Set(['artifact_witnessed'])],
  ['artifact_witnessed', new Set(['artifact_deviations_compared'])],
  ['artifact_deviations_compared', new Set(['surprise_reviewed'])],
  ['surprise_reviewed', new Set(['artifact_audited'])],
  ['post_result_evidence_unavailable', new Set(['audience_predicted', 'memory_consolidated'])],
  ['artifact_audited', new Set(['artifact_audit_not_passed', 'audience_predicted', 'memory_consolidated'])],
  ['artifact_audit_not_passed', new Set(['audience_predicted', 'memory_consolidated'])],
  ['audience_predicted', new Set(['memory_consolidated'])],
  ['memory_consolidated', new Set(['cycle_completed'])]
]);

const CURATION_DECISIONS = new Set(['accept', 'revise', 'reject_all']);
const COMPARISON_CLASSIFICATIONS = new Set([
  'expected_realization', 'planned_variation', 'neutral_deviation', 'technical_failure',
  'random_incoherence', 'potentially_productive_surprise', 'unresolved'
]);
const REVIEW_CLASSIFICATIONS = new Set([
  'expected_realization', 'planned_variation', 'neutral_deviation', 'generation_error',
  'rejected_accident', 'productive_surprise', 'unresolved_deviation'
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasCycleIdentity(cycleId) {
  return typeof cycleId === 'string' && cycleId.trim().length > 0;
}

function requireEvidenceEnvelope(item, { cycleId, artifact, lockEventId, label }) {
  if (!isRecord(item)) throw new Error(`${label} must be an evidence object.`);
  const requiredText = ['evidence_id', 'source_role', 'source_type', 'timestamp', 'classification'];
  for (const field of requiredText) {
    if (typeof item[field] !== 'string' || item[field].trim().length === 0) throw new Error(`${label}.${field} is required.`);
  }
  if (item.cycle_id !== cycleId) throw new Error(`${label} has mismatched cycle identity.`);
  if (item.artifact_id !== artifact.artifact_id || item.artifact_hash !== artifact.artifact_hash) {
    throw new Error(`${label} has mismatched artifact identity or artifact hash.`);
  }
  if (item.locked_intention_event_id !== lockEventId) throw new Error(`${label} has a broken locked-intention link.`);
  if (item.schema_version !== 1) throw new Error(`${label} requires evidence schema version 1.`);
  if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error(`${label}.confidence must be between 0 and 1.`);
  if (typeof item.memory_eligible !== 'boolean' || typeof item.later_used !== 'boolean') throw new Error(`${label} requires memory eligibility and later-use flags.`);
  if (typeof item.review_status !== 'string') throw new Error(`${label}.review_status is required.`);
}

function assertUniqueIds(items, field, label) {
  const ids = items.map((item) => item?.[field]);
  if (ids.some((value) => typeof value !== 'string' || !value)) throw new Error(`${label} requires ${field}.`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate ${field}.`);
  return new Set(ids);
}

function validatePostResultEvidence(type, payload, cycleId, events) {
  if (!['artifact_witnessed', 'artifact_deviations_compared', 'surprise_reviewed', 'post_result_evidence_unavailable'].includes(type)) return;
  const cycleEvents = events.filter((event) => event.cycle_id === cycleId);
  const artifact = cycleEvents.find((event) => event.type === 'artifact_generated')?.payload;
  if (type === 'post_result_evidence_unavailable') {
    if (artifact) throw new Error('post_result_evidence_unavailable is invalid after an artifact exists.');
    return;
  }
  if (!artifact?.artifact_id || !artifact?.artifact_hash) throw new Error(`${type} requires a recorded artifact identity and artifact hash.`);
  if (payload.artifact_id !== artifact.artifact_id || payload.artifact_hash !== artifact.artifact_hash) {
    throw new Error(`${type} has mismatched artifact identity or artifact hash.`);
  }
  const lockEventId = cycleEvents.find((event) => event.type === 'intention_locked')?.event_id;
  const witness = cycleEvents.find((event) => event.type === 'artifact_witnessed')?.payload;
  const compared = cycleEvents.find((event) => event.type === 'artifact_deviations_compared')?.payload;

  if (type === 'artifact_witnessed') {
    if (!Array.isArray(payload.observations) || payload.observations.length === 0) throw new Error('artifact_witnessed requires at least one observation.');
    assertUniqueIds(payload.observations, 'evidence_id', 'artifact witness observations');
    payload.observations.forEach((item, index) => {
      requireEvidenceEnvelope(item, { cycleId, artifact, lockEventId, label: `artifact witness observation ${index}` });
      if (item.source_role !== 'artifact_witness' || item.source_type !== 'artifact_observation' || item.classification !== 'artifact_observation') {
        throw new Error(`artifact witness observation ${index} has invalid source typing.`);
      }
      if (typeof item.description !== 'string' || !item.description.trim() ||
          typeof item.observable_support !== 'string' || !item.observable_support.trim()) {
        throw new Error(`artifact witness observation ${index} requires description and observable support.`);
      }
    });
    return;
  }

  const witnessIds = assertUniqueIds(witness?.observations ?? [], 'evidence_id', 'persisted witness observations');
  if (type === 'artifact_deviations_compared') {
    if (!Array.isArray(payload.witness_evidence_ids) || payload.witness_evidence_ids.length !== witnessIds.size ||
        payload.witness_evidence_ids.some((item) => !witnessIds.has(item))) {
      throw new Error(`${type} has a broken witness evidence link.`);
    }
    if (!Array.isArray(payload.plan_items) || !Array.isArray(payload.comparisons) || payload.comparisons.length === 0) {
      throw new Error('artifact_deviations_compared requires plan items and comparison evidence.');
    }
    const planIds = assertUniqueIds(payload.plan_items, 'plan_item_id', 'comparison plan items');
    for (const [index, item] of payload.plan_items.entries()) {
      const expectedPlanId = `plan_${createHash('sha256').update(canonicalize({
        classification: item.classification,
        description: item.description,
        source_event_id: item.source_event_id,
        source_candidate_id: item.source_candidate_id ?? null
      })).digest('hex').slice(0, 24)}`;
      const sourceEvent = cycleEvents.find((event) => event.event_id === item.source_event_id);
      const sourceCandidate = sourceEvent?.type === 'candidates_generated'
        ? sourceEvent.payload?.candidates?.find((candidate) => candidate.id === item.source_candidate_id)
        : sourceEvent?.type === 'candidate_revised' && sourceEvent.payload?.revised_candidate?.id === item.source_candidate_id
          ? sourceEvent.payload.revised_candidate
          : null;
      const candidateValues = item.classification === 'planned_ambiguity'
        ? [sourceCandidate?.planned_ambiguity, sourceCandidate?.proposed_accident, ...(sourceCandidate?.planned_ambiguities ?? [])]
        : item.classification === 'planned_variation'
          ? sourceCandidate?.planned_variations ?? []
          : [sourceCandidate?.anticipated_risk, ...(sourceCandidate?.anticipated_risks ?? [])];
      const candidateSourceValid = candidateValues.includes(item.description);
      const lockedIntention = sourceEvent?.payload?.intention ?? {};
      const intentionSourceValid = sourceEvent?.type === 'intention_locked' && item.classification === 'anticipated_risk' &&
        item.source_candidate_id === null && [lockedIntention.anticipated_risk, ...(lockedIntention.anticipated_risks ?? [])].includes(item.description);
      if (!['anticipated_risk', 'planned_ambiguity', 'planned_variation'].includes(item.classification) ||
          typeof item.description !== 'string' || !item.description.trim() || item.intentional !== true ||
          item.plan_item_id !== expectedPlanId || (!candidateSourceValid && !intentionSourceValid)) {
        throw new Error(`comparison plan item ${index} has invalid plan provenance.`);
      }
    }
    assertUniqueIds(payload.comparisons, 'evidence_id', 'comparison evidence');
    payload.comparisons.forEach((item, index) => {
      requireEvidenceEnvelope(item, { cycleId, artifact, lockEventId, label: `comparison evidence ${index}` });
      if (item.source_role !== 'deviation_comparator' || item.source_type !== 'artifact_deviation') {
        throw new Error(`comparison evidence ${index} has invalid source typing.`);
      }
      if (!COMPARISON_CLASSIFICATIONS.has(item.classification) || typeof item.description !== 'string' || !item.description.trim()) {
        throw new Error(`comparison evidence ${index} has invalid classification or description.`);
      }
      if (!witnessIds.has(item.witness_evidence_id)) throw new Error(`comparison evidence ${index} has a broken witness evidence link.`);
      if (!Array.isArray(item.related_plan_item_ids) || item.related_plan_item_ids.some((planId) => !planIds.has(planId))) {
        throw new Error(`comparison evidence ${index} has an unknown related plan item.`);
      }
      if (item.explicitly_planned !== (item.related_plan_item_ids.length > 0 || item.explicitly_planned === true)) {
        throw new Error(`comparison evidence ${index} has inconsistent planned classification.`);
      }
    });
    return;
  }

  if (!Array.isArray(compared?.witness_evidence_ids) || compared.witness_evidence_ids.some((item) => !witnessIds.has(item))) {
    throw new Error('surprise_reviewed follows comparison evidence with broken witness links.');
  }
  const comparisonIds = assertUniqueIds(compared?.comparisons ?? [], 'evidence_id', 'persisted comparison evidence');
  if (!Array.isArray(payload.reviewed_evidence) || payload.reviewed_evidence.length !== comparisonIds.size) {
    throw new Error('surprise_reviewed must review every comparison exactly once.');
  }
  assertUniqueIds(payload.reviewed_evidence, 'evidence_id', 'reviewed evidence');
  const reviewedComparisonIds = assertUniqueIds(payload.reviewed_evidence, 'comparison_evidence_id', 'reviewed evidence');
  if (reviewedComparisonIds.size !== comparisonIds.size || [...reviewedComparisonIds].some((item) => !comparisonIds.has(item))) {
    throw new Error('surprise_reviewed has a broken comparison evidence link.');
  }
  const comparisonById = new Map(compared.comparisons.map((item) => [item.evidence_id, item]));
  const witnessById = new Map(witness.observations.map((item) => [item.evidence_id, item]));
  payload.reviewed_evidence.forEach((item, index) => {
    requireEvidenceEnvelope(item, { cycleId, artifact, lockEventId, label: `reviewed evidence ${index}` });
    if (item.source_role !== 'adversarial_surprise_reviewer' || item.source_type !== item.classification ||
        !REVIEW_CLASSIFICATIONS.has(item.classification) || typeof item.description !== 'string' || !item.description.trim()) {
      throw new Error(`reviewed evidence ${index} has invalid source typing, classification, or description.`);
    }
    if (!Array.isArray(item.witness_evidence_ids) || item.witness_evidence_ids.some((witnessId) => !witnessIds.has(witnessId))) {
      throw new Error(`reviewed evidence ${index} has a broken witness evidence link.`);
    }
    const sourceComparison = comparisonById.get(item.comparison_evidence_id);
    if (item.witness_evidence_ids.length !== 1 || item.witness_evidence_ids[0] !== sourceComparison?.witness_evidence_id) {
      throw new Error(`reviewed evidence ${index} does not identify its comparison's source witness.`);
    }
    if (item.classification !== 'productive_surprise') return;
    const source = sourceComparison;
    const sourceWitness = witnessById.get(source?.witness_evidence_id);
    const findings = item.adversarial_findings;
    const findingsPass = findings?.planned === false && findings?.trivial === false && findings?.incoherent === false &&
      findings?.common_in_prior_work === false && findings?.technical_defect === false && findings?.falsely_inferred === false &&
      findings?.observable_support === true && findings?.material_interpretive_change === true && findings?.relates_to_work === true;
    if (source?.classification !== 'potentially_productive_surprise' || !sourceWitness?.observable_support?.trim() ||
        source.explicitly_planned || source.related_plan_item_ids?.length ||
        !source.observable_support || !source.coherent || !source.material_interpretive_change || !source.relates_to_work ||
        item.review_status !== 'confirmed' || item.memory_eligible !== true || item.confidence <= 0 ||
        !Array.isArray(item.challenges) || item.challenges.length === 0 || !findingsPass) {
      throw new Error('productive surprise confirmation lacks required observable and adversarial criteria.');
    }
  });
  const foundProductive = payload.reviewed_evidence.some((item) => item.classification === 'productive_surprise');
  if (typeof payload.no_productive_surprise !== 'boolean' || payload.no_productive_surprise === foundProductive) {
    throw new Error('surprise_reviewed has inconsistent no_productive_surprise status.');
  }
}

export function eventSchemaVersion(event) {
  return event.schema_version === undefined
    ? LEGACY_EVENT_SCHEMA_VERSION
    : event.schema_version;
}

// Version-0 events predate the schema_version field. This adapter is an
// in-memory view used for compatibility checks; the persisted event and its
// hash input are never changed.
export function adaptVersion0Event(event) {
  if (event.schema_version !== undefined) return event;
  return { ...event, schema_version: LEGACY_EVENT_SCHEMA_VERSION };
}

export function terminalEventForCycle(events, cycleId) {
  return events.find((event) =>
    event.cycle_id === cycleId && CYCLE_TERMINAL_TYPES.has(event.type)
  ) ?? null;
}

function validateEnvelope({ type, actor, cycleId, payload, schemaVersion }) {
  if (!LEDGER_EVENT_TYPES.has(type)) {
    throw new Error(`Unknown ledger event type: ${type}`);
  }
  if (schemaVersion !== CURRENT_EVENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported ledger schema version: ${schemaVersion}. New events require schema version ${CURRENT_EVENT_SCHEMA_VERSION}.`);
  }
  if (typeof actor !== 'string' || actor.trim().length === 0) {
    throw new Error('Ledger event actor must be a non-empty string.');
  }
  if (!isRecord(payload)) {
    throw new Error('Ledger event payload must be an object.');
  }

  const requiresCycle = CYCLE_EVENT_TYPES.has(type) ||
    type === 'human_review_recorded' ||
    type === 'mailbox_observations_consumed';
  if (requiresCycle && !hasCycleIdentity(cycleId)) {
    throw new Error(`Ledger event ${type} requires a non-empty cycle identity.`);
  }
  if (GLOBAL_EVENT_TYPES.has(type) && cycleId !== null && cycleId !== undefined) {
    throw new Error(`Ledger event ${type} does not accept a cycle identity.`);
  }
  if (type === 'memory_corrected' && cycleId !== null && cycleId !== undefined && !hasCycleIdentity(cycleId)) {
    throw new Error('Ledger event memory_corrected requires a non-empty cycle identity when one is supplied.');
  }
}

function validatePostCycleTransition({ type, cycleId }, events) {
  if (type === 'memory_corrected' && (cycleId === null || cycleId === undefined)) return;
  const terminal = terminalEventForCycle(events, cycleId);
  if (!terminal) {
    throw new Error(`Post-cycle event ${type} requires a terminal cycle outcome.`);
  }
  if (type !== 'memory_corrected' && terminal.type !== 'cycle_completed') {
    throw new Error(`Post-cycle event ${type} requires cycle_completed.`);
  }
}

function validateCycleTransition({ type, cycleId, payload }, events, { allowLegacyLifecycle = false } = {}) {
  const cycleEvents = events.filter((event) =>
    event.cycle_id === cycleId && CYCLE_EVENT_TYPES.has(event.type)
  );
  const terminal = cycleEvents.find((event) => CYCLE_TERMINAL_TYPES.has(event.type));

  if (type === 'cycle_started') {
    if (cycleEvents.length > 0) throw new Error(`Cycle ${cycleId} is already started.`);
    return;
  }

  if (cycleEvents.length === 0 || cycleEvents[0].type !== 'cycle_started') {
    throw new Error(`Cycle ${cycleId} requires cycle_started before ${type}.`);
  }
  if (terminal) {
    throw new Error(`Cycle ${cycleId} already has terminal event ${terminal.type}; ${type} is not permitted.`);
  }

  if (type === 'intention_locked' && cycleEvents.some((event) => event.type === 'intention_locked')) {
    throw new Error(`Cycle ${cycleId} already has an effective intention lock.`);
  }
  if (type === 'candidate_revised' && cycleEvents.some((event) => event.type === 'candidate_revised')) {
    throw new Error(`Cycle ${cycleId} already has a candidate revision.`);
  }

  const last = cycleEvents.at(-1);
  if (type === 'cycle_failed') return;
  if (type === 'cycle_completed' && last.type !== 'memory_consolidated') {
    throw new Error(`Cycle ${cycleId} requires memory_consolidated before cycle_completed.`);
  }

  if (type === 'curation_decided') {
    const priorCurations = cycleEvents.filter((event) => event.type === 'curation_decided').length;
    if (!CURATION_DECISIONS.has(payload.decision)) {
      throw new Error(`Cycle ${cycleId} curation_decided requires a valid decision.`);
    }
    if (payload.round !== priorCurations) {
      throw new Error(`Cycle ${cycleId} curation round ${payload.round} does not match expected round ${priorCurations}.`);
    }
    if (priorCurations >= 2) {
      throw new Error(`Cycle ${cycleId} already has the maximum legal curation decisions.`);
    }
    if (priorCurations === 1 && payload.decision === 'revise') {
      throw new Error(`Cycle ${cycleId} final curation cannot request another revision.`);
    }
  }

  if (type === 'curation_overridden_by_condition') {
    if (last.payload?.decision === 'accept') {
      throw new Error(`Curation decision accept does not permit an acceptance override for ${cycleId}.`);
    }
    if (payload.decision !== 'accept') {
      throw new Error(`Curation override for ${cycleId} must produce decision accept.`);
    }
  }

  let allowed = ALLOWED_NEXT_CYCLE_EVENTS.get(last.type);
  if (last.type === 'curation_decided') {
    if (last.payload?.decision === 'accept') {
      allowed = new Set(['artifact_generated', 'post_result_evidence_unavailable']);
      if (allowLegacyLifecycle) allowed = new Set([...allowed, 'audience_predicted', 'memory_consolidated']);
    } else if (last.payload?.decision === 'revise') {
      allowed = new Set(['curation_overridden_by_condition', 'candidate_revised']);
    } else if (last.payload?.decision === 'reject_all') {
      allowed = new Set(['curation_overridden_by_condition', 'memory_consolidated']);
    } else {
      throw new Error(`Cycle ${cycleId} has invalid prior curation decision ${last.payload?.decision}.`);
    }
  }
  if (allowLegacyLifecycle && last.type === 'curation_overridden_by_condition') {
    allowed = new Set([...allowed, 'audience_predicted', 'memory_consolidated']);
  }
  if (allowLegacyLifecycle && last.type === 'artifact_generated') {
    allowed = new Set([...allowed, 'artifact_audited']);
  }
  if (!allowed?.has(type)) {
    const detail = last.type === 'curation_decided' ? ` (${last.payload?.decision})` : '';
    throw new Error(`Invalid lifecycle transition for ${cycleId}: ${last.type}${detail} -> ${type}.`);
  }

  if (type === 'artifact_witnessed') {
    if (typeof payload.artifact_id !== 'string' || typeof payload.artifact_hash !== 'string' || !Array.isArray(payload.observations)) {
      throw new Error('artifact_witnessed requires artifact identity, hash, and observations.');
    }
  }
  if (type === 'artifact_deviations_compared') {
    if (typeof payload.artifact_id !== 'string' || !Array.isArray(payload.witness_evidence_ids) || !Array.isArray(payload.comparisons)) {
      throw new Error('artifact_deviations_compared requires artifact identity and linked comparison evidence.');
    }
  }
  if (type === 'surprise_reviewed') {
    if (typeof payload.artifact_id !== 'string' || !Array.isArray(payload.reviewed_evidence)) {
      throw new Error('surprise_reviewed requires artifact identity and reviewed evidence.');
    }
    if (payload.reviewed_evidence.some((item) => item.classification === 'productive_surprise' && item.review_status !== 'confirmed')) {
      throw new Error('productive_surprise requires confirmed adversarial review.');
    }
  }
  validatePostResultEvidence(type, payload, cycleId, events);
}

export function validateEventBeforeAppend(event, existingEvents, options = {}) {
  validateEnvelope(event);
  if (POST_CYCLE_EVENT_TYPES.has(event.type)) {
    validatePostCycleTransition(event, existingEvents);
    return;
  }
  if (CYCLE_EVENT_TYPES.has(event.type)) {
    validateCycleTransition(event, existingEvents, options);
    return;
  }
  if (event.type === 'studio_initialized' && existingEvents.some((item) => item.type === 'studio_initialized')) {
    throw new Error('The ledger already contains studio_initialized.');
  }
}

export function validateStoredVersionedEvent(event, priorEvents) {
  const adapted = adaptVersion0Event(event);
  if (adapted.schema_version === LEGACY_EVENT_SCHEMA_VERSION) return;
  validateEventBeforeAppend({
    type: adapted.type,
    actor: adapted.actor,
    cycleId: adapted.cycle_id,
    payload: adapted.payload,
    schemaVersion: adapted.schema_version
  }, priorEvents, { allowLegacyLifecycle: true });
}
