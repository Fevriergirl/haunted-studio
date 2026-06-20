import { assertOperationCompatible, operationFingerprint, operationIdentity, serializeOperation } from '../core/operations.js';
import { maybeInjectCrash } from '../core/crash-injection.js';

export async function recordMailboxConsumption(options) {
  const resolvedOperationId = operationIdentity(options.operationId, 'mailbox-consumption-operation');
  return serializeOperation(`mailbox-consumption:${options.studio.rootDir}:${resolvedOperationId}`, () =>
    recordMailboxConsumptionUnlocked({ ...options, operationId: resolvedOperationId }));
}

async function recordMailboxConsumptionUnlocked({ studio, cycleId, messageIds, operationId, crashAfter = null }) {
  await studio.initialize();
  const normalizedIds = [...new Set(messageIds)].sort();
  const resolvedOperationId = operationId;
  const fingerprint = operationFingerprint({ kind: 'mailbox_consumption', cycle_id: cycleId, message_ids: normalizedIds });
  const events = await studio.ledger.readAll();
  const prior = assertOperationCompatible(events, resolvedOperationId, fingerprint)
    .find((event) => event.type === 'mailbox_observations_consumed');
  if (prior) return prior;
  const event = await studio.ledger.append({
    type: 'mailbox_observations_consumed',
    actor: 'orchestrator',
    cycleId,
    payload: { message_ids: normalizedIds, operation_id: resolvedOperationId, operation_fingerprint: fingerprint }
  });
  maybeInjectCrash(crashAfter, 'mailbox_observations_consumed');
  await studio.projectAndSave();
  return event;
}
