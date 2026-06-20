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
});
