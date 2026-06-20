import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppendOnlyLedger } from '../src/core/ledger.js';

test('ledger creates and verifies a hash chain', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-ledger-'));
  const ledger = new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
  await ledger.append({ type: 'studio_initialized', actor: 'test', payload: { value: 1 } });
  await ledger.append({ type: 'mailbox_message_received', actor: 'test', payload: { value: 2 } });
  const result = await ledger.verify();
  assert.equal(result.valid, true);
  assert.equal(result.count, 2);
});

test('ledger detects altered history', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-ledger-'));
  const filePath = path.join(directory, 'ledger.jsonl');
  const ledger = new AppendOnlyLedger(filePath);
  await ledger.append({ type: 'studio_initialized', actor: 'test', payload: { value: 1 } });
  const events = (await readFile(filePath, 'utf8')).trim().split('\n').map(JSON.parse);
  events[0].payload.value = 99;
  await writeFile(filePath, `${events.map(JSON.stringify).join('\n')}\n`);
  const result = await ledger.verify();
  assert.equal(result.valid, false);
  assert.match(result.error, /Hash mismatch/);
});
