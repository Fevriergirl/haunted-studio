import { access, cp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppendOnlyLedger } from '../core/ledger.js';
import { Studio } from '../core/studio.js';
import { readJson, writeJsonAtomic } from '../core/fs.js';
import {
  assertOperationCompatible,
  operationFingerprint,
  operationIdentity,
  operationScopePath,
  serializeOperation
} from '../core/operations.js';
import { maybeInjectCrash } from '../core/crash-injection.js';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function forkResult(event, targetRoot, verification) {
  return {
    forkId: event.payload.fork_id,
    targetRoot,
    parentHead: event.payload.parent_ledger_head,
    verification
  };
}

export async function forkStudio(options) {
  const operationId = operationIdentity(options.operationId, 'fork-operation');
  return serializeOperation(`studio-write:${operationScopePath(options.studio.rootDir)}`, () =>
    forkStudioUnlocked({ ...options, operationId }));
}

async function forkStudioUnlocked({ studio, targetRoot, label, operationId, crashAfter = null }) {
  await studio.initialize();
  const fingerprint = operationFingerprint({
    kind: 'studio_fork',
    target: operationScopePath(targetRoot),
    label,
    parent_studio: operationScopePath(studio.rootDir)
  });

  if (await exists(targetRoot)) {
    const targetStudio = new Studio({ rootDir: targetRoot, constitution: studio.constitution, experiment: studio.experiment });
    const events = await targetStudio.ledger.readAll();
    const prior = assertOperationCompatible(events, operationId, fingerprint)
      .find((event) => event.type === 'studio_forked');
    if (!prior) throw new Error(`Fork target already exists: ${targetRoot}`);
    await targetStudio.initialize();
    return forkResult(prior, targetRoot, await targetStudio.ledger.verify());
  }

  const stagingSuffix = operationFingerprint({ operation_id: operationId }).slice(0, 16);
  const stagingRoot = `${targetRoot}.fork-staging-${stagingSuffix}`;
  const markerPath = path.join(stagingRoot, '.fork-operation.json');
  let marker;

  if (await exists(stagingRoot)) {
    marker = await readJson(markerPath);
    if (marker.operation_id !== operationId || marker.operation_fingerprint !== fingerprint ||
      operationScopePath(marker.target_root) !== operationScopePath(targetRoot)) {
      throw new Error(`Fork staging conflict for ${targetRoot}.`);
    }
    const parentEvents = await studio.ledger.readAll();
    if (!parentEvents.some((event) => event.hash === marker.parent_ledger_head)) {
      throw new Error('Fork staging parent head is not present in the current parent ledger.');
    }
  } else {
    const parentVerification = await studio.ledger.verify();
    if (!parentVerification.valid) throw new Error(`Cannot fork an invalid ledger: ${parentVerification.error}. Restore an intact ledger backup before retrying.`);
    await cp(studio.rootDir, stagingRoot, { recursive: true, errorOnExist: true });
    const copiedLedger = new AppendOnlyLedger(path.join(stagingRoot, 'ledger.jsonl'));
    const copiedVerification = await copiedLedger.verify();
    if (!copiedVerification.valid || copiedVerification.head !== parentVerification.head) {
      await rm(stagingRoot, { recursive: true, force: true });
      throw new Error('Parent changed during fork copy; the unpublished staging copy was discarded. Retry the fork operation.');
    }
    marker = {
      operation_id: operationId,
      operation_fingerprint: fingerprint,
      target_root: operationScopePath(targetRoot),
      parent_ledger_head: parentVerification.head
    };
    await writeJsonAtomic(markerPath, marker);
    maybeInjectCrash(crashAfter, 'fork_copied');
  }

  const stagingStudio = new Studio({ rootDir: stagingRoot, constitution: studio.constitution, experiment: studio.experiment });
  const stagingEvents = await stagingStudio.ledger.readAll();
  let forkEvent = assertOperationCompatible(stagingEvents, operationId, fingerprint)
    .find((event) => event.type === 'studio_forked');
  if (!forkEvent) {
    forkEvent = await stagingStudio.ledger.append({
      type: 'studio_forked',
      actor: 'experiment-orchestrator',
      payload: {
        fork_id: `fork_${Date.now()}`,
        label,
        parent_studio: path.basename(studio.rootDir),
        parent_ledger_head: marker.parent_ledger_head,
        forked_at: new Date().toISOString(),
        operation_id: operationId,
        operation_fingerprint: fingerprint
      }
    });
  }
  maybeInjectCrash(crashAfter, 'studio_forked');
  await stagingStudio.projectAndSave();
  const verification = await stagingStudio.ledger.verify();
  if (!verification.valid) throw new Error(`Fork staging ledger is invalid: ${verification.error}`);
  await rename(stagingRoot, targetRoot);
  return forkResult(forkEvent, targetRoot, verification);
}
