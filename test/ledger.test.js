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

test('subscribers observe each append live, exactly as persisted', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-ledger-live-'));
  const ledger = new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
  const seen = [];
  const unsubscribe = ledger.subscribe((event) => seen.push(event));
  // A throwing listener must never break or reorder the append itself.
  ledger.subscribe(() => { throw new Error('observer failure'); });

  const first = await ledger.append({ type: 'studio_initialized', actor: 'test', payload: { value: 1 } });
  const second = await ledger.append({ type: 'mailbox_message_received', actor: 'test', payload: { value: 2 } });
  assert.deepEqual(seen, [first, second]);
  assert.equal((await ledger.verify()).valid, true);

  unsubscribe();
  await ledger.append({ type: 'mailbox_message_received', actor: 'test', payload: { value: 3 } });
  assert.equal(seen.length, 2, 'unsubscribed listeners hear nothing further');
});

test('idempotent replays notify no subscriber — only new history is announced', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-ledger-live-replay-'));
  const ledger = new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
  const request = {
    type: 'mailbox_message_received',
    actor: 'test',
    payload: {
      operation_id: 'operation_live_replay',
      operation_fingerprint: 'fingerprint-live',
      message_id: 'message-live'
    }
  };
  await ledger.append(request);
  const seen = [];
  ledger.subscribe((event) => seen.push(event));
  const repeated = await ledger.append(request);
  assert.equal(repeated.type, 'mailbox_message_received');
  assert.equal(seen.length, 0, 'a replayed operation appends nothing, so it announces nothing');
});

test('serialized append is idempotent for one operation and event type', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-ledger-operation-'));
  const ledger = new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
  const request = {
    type: 'mailbox_message_received',
    actor: 'test',
    payload: {
      operation_id: 'operation_ledger_retry',
      operation_fingerprint: 'fingerprint-one',
      message_id: 'message-one'
    }
  };
  const [first, repeated] = await Promise.all([ledger.append(request), ledger.append(request)]);
  assert.equal(repeated.event_id, first.event_id);
  assert.equal((await ledger.readAll()).length, 1);
  await assert.rejects(
    ledger.append({
      ...request,
      payload: { ...request.payload, operation_fingerprint: 'fingerprint-conflict' }
    }),
    /operation conflict/i
  );
});
