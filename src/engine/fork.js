import { cp, access } from 'node:fs/promises';
import path from 'node:path';
import { AppendOnlyLedger } from '../core/ledger.js';
import { readJson, writeJsonAtomic } from '../core/fs.js';

export async function forkStudio({ studio, targetRoot, label }) {
  await studio.initialize();
  try {
    await access(targetRoot);
    throw new Error(`Fork target already exists: ${targetRoot}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const parentVerification = await studio.ledger.verify();
  if (!parentVerification.valid) throw new Error(`Cannot fork an invalid ledger: ${parentVerification.error}`);

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
      forked_at: new Date().toISOString()
    }
  });

  const statePath = path.join(targetRoot, 'state.json');
  const state = await readJson(statePath);
  state.branch = {
    fork_id: forkId,
    label,
    parent_studio: parentStudio,
    parent_ledger_head: parentVerification.head
  };
  await writeJsonAtomic(statePath, state);

  return { forkId, targetRoot, parentHead: parentVerification.head, verification: await forkLedger.verify() };
}
