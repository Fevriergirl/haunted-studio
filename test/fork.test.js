import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { forkStudio } from '../src/engine/fork.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));

test('fork provenance preserves the ledger without storing an absolute parent path', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-fork-'));
  const rootDir = path.join(parent, 'source-studio');
  const targetRoot = path.join(parent, 'forked-studio');
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();

  const result = await forkStudio({ studio, targetRoot, label: 'test fork' });
  assert.equal(result.verification.valid, true);

  const ledgerText = await readFile(path.join(targetRoot, 'ledger.jsonl'), 'utf8');
  assert.doesNotMatch(ledgerText, new RegExp(parent.replaceAll('\\', '\\\\')));
  const forkEvents = await new Studio({ rootDir: targetRoot, constitution, experiment }).ledger.readAll();
  const event = forkEvents.at(-1);
  assert.equal(event.payload.parent_studio, 'source-studio');
  assert.equal('parent_root' in event.payload, false);
});
