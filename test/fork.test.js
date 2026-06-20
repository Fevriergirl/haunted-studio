import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { forkStudio } from '../src/engine/fork.js';
import { readJson } from '../src/core/fs.js';
import { AppendOnlyLedger } from '../src/core/ledger.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));

test('fork provenance preserves the ledger without storing an absolute parent path', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-fork-'));
  const rootDir = path.join(parent, 'source-studio');
  const targetRoot = path.join(parent, 'forked-studio');
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const parentLedgerBefore = await readFile(path.join(rootDir, 'ledger.jsonl'), 'utf8');
  const parentStateBefore = await readFile(path.join(rootDir, 'state.json'), 'utf8');

  const result = await forkStudio({ studio, targetRoot, label: 'test fork' });
  assert.equal(result.verification.valid, true);

  const ledgerText = await readFile(path.join(targetRoot, 'ledger.jsonl'), 'utf8');
  assert.doesNotMatch(ledgerText, new RegExp(parent.replaceAll('\\', '\\\\')));
  const forkEvents = await new Studio({ rootDir: targetRoot, constitution, experiment }).ledger.readAll();
  const event = forkEvents.at(-1);
  assert.equal(event.payload.parent_studio, 'source-studio');
  assert.equal('parent_root' in event.payload, false);
  assert.equal(await readFile(path.join(rootDir, 'ledger.jsonl'), 'utf8'), parentLedgerBefore);
  assert.equal(await readFile(path.join(rootDir, 'state.json'), 'utf8'), parentStateBefore);
});

test('fork retry with one operation identity is a no-op and conflicting payload is rejected', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-fork-retry-'));
  const rootDir = path.join(parent, 'source-studio');
  const targetRoot = path.join(parent, 'forked-studio');
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const operationId = 'operation_fork_retry';
  const first = await forkStudio({ studio, targetRoot, label: 'test fork', operationId });
  const repeated = await forkStudio({ studio, targetRoot, label: 'test fork', operationId });
  assert.equal(repeated.forkId, first.forkId);
  const forkEvents = await new Studio({ rootDir: targetRoot, constitution, experiment }).ledger.readAll();
  assert.equal(forkEvents.filter((event) => event.type === 'studio_forked').length, 1);
  await assert.rejects(
    forkStudio({ studio, targetRoot, label: 'conflicting label', operationId }),
    /operation conflict/i
  );
});

test('fork resumes after copy crash and remains retryable after parent history advances', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-fork-copy-crash-'));
  const rootDir = path.join(parent, 'source-studio');
  const targetRoot = path.join(parent, 'forked-studio');
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const operationId = 'operation_fork_copy_crash';
  await assert.rejects(
    forkStudio({ studio, targetRoot, label: 'recoverable fork', operationId, crashAfter: 'fork_copied' }),
    /injected crash/i
  );
  const recovered = await forkStudio({ studio, targetRoot, label: 'recoverable fork', operationId });
  await studio.ledger.append({ type: 'mailbox_message_received', actor: 'test', payload: {} });
  await studio.projectAndSave();
  const repeated = await forkStudio({ studio, targetRoot, label: 'recoverable fork', operationId });
  assert.equal(repeated.forkId, recovered.forkId);
  assert.equal((await new AppendOnlyLedger(path.join(targetRoot, 'ledger.jsonl')).readAll()).filter((event) => event.type === 'studio_forked').length, 1);
});

test('fork retry after provenance append repairs and publishes the target projection', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-fork-event-crash-'));
  const rootDir = path.join(parent, 'source-studio');
  const targetRoot = path.join(parent, 'forked-studio');
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const operationId = 'operation_fork_event_crash';
  await assert.rejects(
    forkStudio({ studio, targetRoot, label: 'event crash', operationId, crashAfter: 'studio_forked' }),
    /injected crash/i
  );
  const recovered = await forkStudio({ studio, targetRoot, label: 'event crash', operationId });
  const targetStudio = new Studio({ rootDir: targetRoot, constitution, experiment });
  const state = await targetStudio.initialize();
  assert.equal(state.ledger_head.event_hash, (await targetStudio.ledger.readAll()).at(-1).hash);
  assert.equal(recovered.verification.valid, true);
});

test('fork refuses to commandeer an unrelated existing parent-prefix snapshot', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-fork-existing-'));
  const rootDir = path.join(parent, 'source-studio');
  const targetRoot = path.join(parent, 'existing-snapshot');
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  await cp(rootDir, targetRoot, { recursive: true });
  const before = await readFile(path.join(targetRoot, 'ledger.jsonl'), 'utf8');
  await assert.rejects(
    forkStudio({ studio, targetRoot, label: 'must reject', operationId: 'operation_unrelated_target' }),
    /already exists/i
  );
  assert.equal(await readFile(path.join(targetRoot, 'ledger.jsonl'), 'utf8'), before);
});

test('fork operation identity conflicts when reused for a different target or label', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-fork-operation-conflict-'));
  const rootDir = path.join(parent, 'source-studio');
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  const operationId = 'operation_fork_source_claim';
  await forkStudio({ studio, targetRoot: path.join(parent, 'fork-a'), label: 'first', operationId });
  await assert.rejects(
    forkStudio({ studio, targetRoot: path.join(parent, 'fork-b'), label: 'second', operationId }),
    /operation conflict/i
  );
});
