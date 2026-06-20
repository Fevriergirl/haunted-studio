import { assertOperationCompatible, operationFingerprint, operationIdentity } from '../core/operations.js';

export async function recordMailboxConsumption({ studio, cycleId, messageIds, operationId }) {
  await studio.initialize();
  const normalizedIds = [...messageIds];
  const resolvedOperationId = operationIdentity(operationId, 'mailbox-consumption-operation');
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
  await studio.projectAndSave();
  return event;
}
