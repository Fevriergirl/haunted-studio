import { assertOperationCompatible, operationFingerprint, operationIdentity, serializeOperation } from '../core/operations.js';
import { maybeInjectCrash } from '../core/crash-injection.js';

export async function abandonCycle(options) {
  const resolvedAbandonmentId = operationIdentity(options.abandonmentOperationId, 'abandon-operation');
  return serializeOperation(`abandon:${options.studio.rootDir}:${resolvedAbandonmentId}`, () =>
    abandonCycleUnlocked({ ...options, abandonmentOperationId: resolvedAbandonmentId }));
}

async function abandonCycleUnlocked({ studio, operationId = null, cycleId = null, abandonmentOperationId, crashAfter = null }) {
  await studio.initialize();
  const events = await studio.ledger.readAll();
  const started = events.find((event) => event.type === 'cycle_started' &&
    (operationId ? event.payload?.operation_id === operationId : event.cycle_id === cycleId));
  const identifier = operationId ?? cycleId;
  if (!started) throw new Error(`No cycle found for ${identifier}.`);
  const fingerprint = operationFingerprint({ kind: 'cycle_abandonment', operation_id: operationId, cycle_id: started.cycle_id });
  const prior = assertOperationCompatible(events, abandonmentOperationId, fingerprint)
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
      operation_id: abandonmentOperationId,
      operation_fingerprint: fingerprint,
      abandoned_operation_id: operationId,
      abandoned_cycle_id: started.cycle_id
    }
  });
  maybeInjectCrash(crashAfter, 'cycle_failed');
  await studio.projectAndSave();
  return event;
}
