// Records the studio operator's accept/reject/unresolved verdict on a finished
// work as a single, idempotent post-cycle ledger event. A thin wrapper over the
// ledger + projection — no business logic of its own.

import {
  assertOperationCompatible,
  operationFingerprint,
  operationIdentity,
  operationScopePath,
  serializeOperation
} from '../core/operations.js';

const DECISIONS = new Set(['accept', 'reject', 'unresolved']);

export async function recordArtifactDecision(options) {
  const resolvedOperationId = operationIdentity(options.operationId, 'decision-operation');
  return serializeOperation(`studio-write:${operationScopePath(options.studio.rootDir)}`, () =>
    recordArtifactDecisionUnlocked({ ...options, operationId: resolvedOperationId }));
}

async function recordArtifactDecisionUnlocked({ studio, cycleId, decision, note = '', operationId }) {
  if (!DECISIONS.has(decision)) throw new Error(`Unknown decision: ${decision}. Expected accept, reject, or unresolved.`);
  await studio.initialize();
  const events = await studio.ledger.readAll();
  const manifest = events.find((event) => event.type === 'cycle_completed' && event.cycle_id === cycleId)?.payload;
  if (!manifest) throw new Error(`Cycle ${cycleId} is not completed.`);
  if (!manifest.selected_candidate) throw new Error(`Cycle ${cycleId} has no accepted work to decide on.`);

  const fingerprint = operationFingerprint({ kind: 'artifact_decision', cycle_id: cycleId, decision, note: String(note) });
  const prior = assertOperationCompatible(events, operationId, fingerprint)
    .find((event) => event.type === 'artifact_decision_recorded');
  if (prior) {
    const state = await studio.projectAndSave('idempotent_decision_retry');
    return { decision: prior.payload, state, resumed: true };
  }

  const payload = {
    operation_id: operationId,
    operation_fingerprint: fingerprint,
    cycle_id: cycleId,
    decision,
    note: String(note),
    decided_at: new Date().toISOString()
  };
  await studio.ledger.append({ type: 'artifact_decision_recorded', actor: 'human:studio-operator', cycleId, payload });
  const state = await studio.projectAndSave();
  return { decision: payload, state, resumed: false };
}
