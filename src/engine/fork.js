import { cp, access } from 'node:fs/promises';
import path from 'node:path';
import { AppendOnlyLedger } from '../core/ledger.js';
import { Studio } from '../core/studio.js';
import { assertOperationCompatible, operationFingerprint, operationIdentity, serializeOperation } from '../core/operations.js';
import { maybeInjectCrash } from '../core/crash-injection.js';

export async function forkStudio(options) {
  const resolvedOperationId = operationIdentity(options.operationId, 'fork-operation');
  return serializeOperation(`fork:${options.studio.rootDir}:${resolvedOperationId}`, () =>
    forkStudioUnlocked({ ...options, operationId: resolvedOperationId }));
}

async function forkStudioUnlocked({ studio, targetRoot, label, operationId, crashAfter = null }) {
  await studio.initialize();
  const parentVerification = await studio.ledger.verify();
  if (!parentVerification.valid) throw new Error(`Cannot fork an invalid ledger: ${parentVerification.error}`);
  const resolvedOperationId = operationId;
  const fingerprint = operationFingerprint({
    kind: 'studio_fork',
    target: path.resolve(targetRoot),
    label,
    parent_studio: path.resolve(studio.rootDir)
  });
  try {
    await access(targetRoot);
    const existingLedger = new AppendOnlyLedger(path.join(targetRoot, 'ledger.jsonl'));
    const existingEvents = await existingLedger.readAll();
    const prior = assertOperationCompatible(existingEvents, resolvedOperationId, fingerprint)
      .find((event) => event.type === 'studio_forked');
    if (!prior) {
      const targetVerification = await existingLedger.verify();
      if (!targetVerification.valid) throw new Error(`Fork target ledger is invalid: ${targetVerification.error}`);
      const parentEvents = await studio.ledger.readAll();
      if (!parentEvents.some((event) => event.hash === targetVerification.head)) {
        throw new Error(`Fork target already exists and is not a prefix of the parent: ${targetRoot}`);
      }
      const recoveredForkId = `fork_${Date.now()}`;
      const recovered = await existingLedger.append({
        type: 'studio_forked', actor: 'experiment-orchestrator',
        payload: {
          fork_id: recoveredForkId, label, parent_studio: path.basename(studio.rootDir),
          parent_ledger_head: targetVerification.head, forked_at: new Date().toISOString(),
          operation_id: resolvedOperationId, operation_fingerprint: fingerprint
        }
      });
      maybeInjectCrash(crashAfter, 'studio_forked');
      const targetStudio = new Studio({ rootDir: targetRoot, constitution: studio.constitution, experiment: studio.experiment });
      await targetStudio.projectAndSave();
      return { forkId: recovered.payload.fork_id, targetRoot, parentHead: recovered.payload.parent_ledger_head, verification: await existingLedger.verify() };
    }
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
  maybeInjectCrash(crashAfter, 'fork_copied');
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
  maybeInjectCrash(crashAfter, 'studio_forked');

  const forkStudioState = new Studio({
    rootDir: targetRoot,
    constitution: studio.constitution,
    experiment: studio.experiment
  });
  await forkStudioState.projectAndSave();

  return { forkId, targetRoot, parentHead: parentVerification.head, verification: await forkLedger.verify() };
}
