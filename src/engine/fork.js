import { cp, access } from 'node:fs/promises';
import path from 'node:path';
import { AppendOnlyLedger } from '../core/ledger.js';
import { Studio } from '../core/studio.js';
import { assertOperationCompatible, operationFingerprint, operationIdentity } from '../core/operations.js';

export async function forkStudio({ studio, targetRoot, label, operationId = null }) {
  await studio.initialize();
  const parentVerification = await studio.ledger.verify();
  if (!parentVerification.valid) throw new Error(`Cannot fork an invalid ledger: ${parentVerification.error}`);
  const resolvedOperationId = operationIdentity(operationId, 'fork-operation');
  const fingerprint = operationFingerprint({
    kind: 'studio_fork',
    target: path.resolve(targetRoot),
    label,
    parent_ledger_head: parentVerification.head
  });
  try {
    await access(targetRoot);
    const existingLedger = new AppendOnlyLedger(path.join(targetRoot, 'ledger.jsonl'));
    const existingEvents = await existingLedger.readAll();
    const prior = assertOperationCompatible(existingEvents, resolvedOperationId, fingerprint)
      .find((event) => event.type === 'studio_forked');
    if (!prior) throw new Error(`Fork target already exists: ${targetRoot}`);
    return {
      forkId: prior.payload.fork_id,
      targetRoot,
      parentHead: prior.payload.parent_ledger_head,
      verification: await existingLedger.verify()
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await cp(studio.rootDir, targetRoot, { recursive: true, errorOnExist: true });
  const forkLedger = new AppendOnlyLedger(path.join(targetRoot, 'ledger.jsonl'));
  const forkId = `fork_${Date.now()}`;
  const parentStudio = path.basename(studio.rootDir);
  await forkLedger.append({
    type: 'studio_forked',
    actor: 'experiment-orchestrator',
    payload: {
      fork_id: forkId,
      label,
      parent_studio: parentStudio,
      parent_ledger_head: parentVerification.head,
      forked_at: new Date().toISOString(),
      operation_id: resolvedOperationId,
      operation_fingerprint: fingerprint
    }
  });

  const forkStudioState = new Studio({
    rootDir: targetRoot,
    constitution: studio.constitution,
    experiment: studio.experiment
  });
  await forkStudioState.projectAndSave();

  return { forkId, targetRoot, parentHead: parentVerification.head, verification: await forkLedger.verify() };
}
