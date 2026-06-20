import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonlMailbox } from '../src/mailbox/mailbox.js';
import { startMailboxServer } from '../src/mailbox/server.js';
import { AppendOnlyLedger } from '../src/core/ledger.js';

test('observation mailbox handles health, malformed JSON, and valid messages', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-server-'));
  const mailbox = new JsonlMailbox(path.join(directory, 'mailbox.jsonl'));
  const ledger = new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
  const server = startMailboxServer({ mailbox, ledger, port: 0, host: '127.0.0.1' });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');

  const malformed = await fetch(`${baseUrl}/mailbox/receive`, {
    method: 'POST',
    body: '{'
  });
  assert.equal(malformed.status, 400);

  const invalid = await fetch(`${baseUrl}/mailbox/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'observation_signal' })
  });
  assert.equal(invalid.status, 400);

  const valid = await fetch(`${baseUrl}/mailbox/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'observation_signal',
      sender: 'test',
      payload: { text: 'A test observation.', rights: 'test-authored' }
    })
  });
  assert.equal(valid.status, 202);
  assert.equal((await mailbox.poll()).length, 1);
  assert.equal((await ledger.verify()).valid, true);

  const retryBody = {
    operation_id: 'operation_mailbox_receive_retry',
    type: 'observation_signal',
    sender: 'test',
    payload: { text: 'An idempotent observation.', rights: 'test-authored' }
  };
  const firstRetry = await fetch(`${baseUrl}/mailbox/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(retryBody)
  });
  const secondRetry = await fetch(`${baseUrl}/mailbox/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(retryBody)
  });
  assert.equal(firstRetry.status, 202);
  assert.equal(secondRetry.status, 202);
  assert.equal((await firstRetry.json()).message_id, (await secondRetry.json()).message_id);
  assert.equal((await mailbox.list()).length, 2);
  assert.equal((await ledger.readAll()).filter((event) => event.type === 'mailbox_message_received').length, 2);

  const conflict = await fetch(`${baseUrl}/mailbox/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...retryBody, payload: { text: 'Conflicting payload.' } })
  });
  assert.equal(conflict.status, 400);
  assert.match((await conflict.json()).error, /operation conflict/i);
});

test('mailbox receive retry after ledger append crash does not duplicate message or event', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-server-crash-'));
  const mailbox = new JsonlMailbox(path.join(directory, 'mailbox.jsonl'));
  const ledger = new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
  const server = startMailboxServer({ mailbox, ledger, port: 0, host: '127.0.0.1', crashAfter: 'mailbox_message_received' });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const body = { operation_id: 'operation_mailbox_server_crash', type: 'observation_signal', sender: 'test', payload: { text: 'Once.' } };
  const first = await fetch(`${baseUrl}/mailbox/receive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(first.status, 500);
  const repeated = await fetch(`${baseUrl}/mailbox/receive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(repeated.status, 202);
  assert.equal((await mailbox.list()).length, 1);
  assert.equal((await ledger.readAll()).filter((event) => event.type === 'mailbox_message_received').length, 1);
});
