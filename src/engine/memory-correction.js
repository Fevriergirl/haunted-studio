import { readJson } from '../core/fs.js';
import { assertOperationCompatible, operationFingerprint, operationIdentity } from '../core/operations.js';
import { maybeInjectCrash } from '../core/crash-injection.js';

export async function recordMemoryCorrection({ studio, correctionFile, operationId, crashAfter = null }) {
  await studio.initialize();
  const correction = await readJson(correctionFile);
  if (!correction.target_event_id || !correction.reason || !correction.corrected_interpretation) {
    throw new Error('Correction file requires target_event_id, reason, and corrected_interpretation.');
  }
  const events = await studio.ledger.readAll();
  if (!events.some((event) => event.event_id === correction.target_event_id)) {
    throw new Error(`Target event does not exist: ${correction.target_event_id}`);
  }
  const resolvedOperationId = operationIdentity(operationId, 'correction-operation');
  const fingerprint = operationFingerprint({ kind: 'memory_correction', correction });
  const prior = assertOperationCompatible(events, resolvedOperationId, fingerprint)
    .find((event) => event.type === 'memory_corrected');
  if (prior) {
    await studio.projectAndSave('idempotent_correction_retry');
    return prior;
  }
  const event = await studio.ledger.append({
    type: 'memory_corrected',
    actor: correction.actor ?? 'human-steward',
    cycleId: correction.cycle_id ?? null,
    payload: { ...correction, operation_id: resolvedOperationId, operation_fingerprint: fingerprint }
  });
  maybeInjectCrash(crashAfter, 'memory_corrected');
  await studio.projectAndSave();
  return event;
}
