import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonlMailbox } from '../src/mailbox/mailbox.js';

test('mailbox receives, polls, and acknowledges messages', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-mailbox-'));
  const mailbox = new JsonlMailbox(path.join(directory, 'mailbox.jsonl'));
  const message = await mailbox.receive({ type: 'observation_signal', payload: { text: 'A locked door painted like open sky.' } });
  const pending = await mailbox.poll({ type: 'observation_signal' });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].message_id, message.message_id);
  assert.equal(await mailbox.acknowledge([message.message_id]), 1);
  assert.equal((await mailbox.poll()).length, 0);
});
