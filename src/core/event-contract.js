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
    'audience_predicted',
    'memory_consolidated'
  ])],
  ['candidate_revised', new Set(['revision_critiqued'])],
  ['revision_critiqued', new Set(['curation_decided'])],
  ['artifact_generated', new Set(['artifact_audited'])],
  ['artifact_audited', new Set(['artifact_audit_not_passed', 'audience_predicted', 'memory_consolidated'])],
  ['artifact_audit_not_passed', new Set(['audience_predicted', 'memory_consolidated'])],
  ['audience_predicted', new Set(['memory_consolidated'])],
  ['memory_consolidated', new Set(['cycle_completed'])]
]);

const CURATION_DECISIONS = new Set(['accept', 'revise', 'reject_all']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasCycleIdentity(cycleId) {
  return typeof cycleId === 'string' && cycleId.trim().length > 0;
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

function validateCycleTransition({ type, cycleId, payload }, events) {
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
      allowed = new Set(['artifact_generated', 'audience_predicted', 'memory_consolidated']);
    } else if (last.payload?.decision === 'revise') {
      allowed = new Set(['curation_overridden_by_condition', 'candidate_revised']);
    } else if (last.payload?.decision === 'reject_all') {
      allowed = new Set(['curation_overridden_by_condition', 'memory_consolidated']);
    } else {
      throw new Error(`Cycle ${cycleId} has invalid prior curation decision ${last.payload?.decision}.`);
    }
  }
  if (!allowed?.has(type)) {
    const detail = last.type === 'curation_decided' ? ` (${last.payload?.decision})` : '';
    throw new Error(`Invalid lifecycle transition for ${cycleId}: ${last.type}${detail} -> ${type}.`);
  }
}

export function validateEventBeforeAppend(event, existingEvents) {
  validateEnvelope(event);
  if (POST_CYCLE_EVENT_TYPES.has(event.type)) {
    validatePostCycleTransition(event, existingEvents);
    return;
  }
  if (CYCLE_EVENT_TYPES.has(event.type)) {
    validateCycleTransition(event, existingEvents);
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
  }, priorEvents);
}
