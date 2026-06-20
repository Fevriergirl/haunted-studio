import { assertOperationCompatible, operationFingerprint, operationIdentity } from '../core/operations.js';

export async function abandonCycle({ studio, operationId, abandonmentOperationId }) {
  await studio.initialize();
  const events = await studio.ledger.readAll();
  const started = events.find((event) => event.type === 'cycle_started' && event.payload?.operation_id === operationId);
  if (!started) throw new Error(`No cycle operation found for ${operationId}.`);
  const resolvedAbandonmentId = operationIdentity(abandonmentOperationId, 'abandon-operation');
  const fingerprint = operationFingerprint({ kind: 'cycle_abandonment', operation_id: operationId, cycle_id: started.cycle_id });
  const prior = assertOperationCompatible(events, resolvedAbandonmentId, fingerprint)
    .find((event) => event.type === 'cycle_failed');
  if (prior) return prior;
  const terminal = events.find((event) => event.cycle_id === started.cycle_id && ['cycle_completed', 'cycle_failed'].includes(event.type));
  if (terminal) throw new Error(`Cycle ${started.cycle_id} is already terminal: ${terminal.type}.`);
  const event = await studio.ledger.append({
    type: 'cycle_failed',
    actor: 'recovery:human-steward',
    cycleId: started.cycle_id,
    payload: {
      name: 'CycleAbandoned',
      message: 'Incomplete cycle explicitly abandoned during recovery.',
      operation_id: resolvedAbandonmentId,
      operation_fingerprint: fingerprint,
      abandoned_operation_id: operationId
    }
  });
  await studio.projectAndSave();
  return event;
}
