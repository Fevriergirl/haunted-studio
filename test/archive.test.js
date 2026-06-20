import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));

test('archiving a studio preserves its append-only ledger before reset', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-studio-archive-'));
  const rootDir = path.join(parent, '.haunted-studio');
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  await studio.ledger.append({
    type: 'mailbox_message_received',
    actor: 'test',
    payload: { preserved: true }
  });

  const before = await readFile(path.join(rootDir, 'ledger.jsonl'), 'utf8');
  const archiveRoot = await studio.archive();

  assert.ok(archiveRoot.startsWith(`${rootDir}.archive-`));
  await assert.rejects(access(rootDir), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(archiveRoot, 'ledger.jsonl'), 'utf8'), before);

  const archivedLedger = new Studio({ rootDir: archiveRoot, constitution, experiment }).ledger;
  assert.deepEqual(await archivedLedger.verify(), {
    valid: true,
    count: 2,
    head: (await archivedLedger.readAll()).at(-1).hash
  });
});

test('archiving an absent studio is a no-op', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-studio-empty-'));
  const studio = new Studio({
    rootDir: path.join(parent, '.haunted-studio'),
    constitution,
    experiment
  });

  assert.equal(await studio.archive(), null);
});
