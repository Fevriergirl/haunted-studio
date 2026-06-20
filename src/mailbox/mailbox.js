import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from '../core/fs.js';
import { id } from '../core/ids.js';
import { assertOperationCompatible, operationFingerprint, operationIdentity } from '../core/operations.js';

const receiveQueues = new Map();

async function serializeReceive(filePath, operation) {
  const key = path.resolve(filePath);
  const previous = receiveQueues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  receiveQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (receiveQueues.get(key) === queued) receiveQueues.delete(key);
  }
}

export class JsonlMailbox {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async receive({ type, payload, priority = 'normal', sender = 'external', operation_id: operationId = null }) {
    if (typeof type !== 'string' || type.trim().length === 0) {
      throw new Error('Mailbox message type must be a non-empty string.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Mailbox message payload must be an object.');
    }
    const resolvedOperationId = operationIdentity(operationId, 'mailbox-receive-operation');
    const fingerprint = operationFingerprint({ kind: 'mailbox_receive', type, payload, priority, sender });
    return serializeReceive(this.filePath, async () => {
      const messages = await this.list();
      const prior = assertOperationCompatible(
        messages.map((message) => ({ payload: message })),
        resolvedOperationId,
        fingerprint
      )[0]?.payload;
      if (prior) return prior;
      const message = {
        message_id: id('msg'),
        operation_id: resolvedOperationId,
        operation_fingerprint: fingerprint,
        type,
        payload,
        priority,
        sender,
        status: 'pending',
        created_at: new Date().toISOString(),
        acknowledged_at: null
      };
      await ensureDir(path.dirname(this.filePath));
      await appendFile(this.filePath, `${JSON.stringify(message)}\n`, 'utf8');
      return message;
    });
  }

  async list() {
    try {
      return (await readFile(this.filePath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async poll({ type = null, limit = 10 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Mailbox poll limit must be an integer from 1 to 100.');
    }
    return (await this.list()).filter((message) => message.status === 'pending' && (!type || message.type === type)).slice(0, limit);
  }

  async acknowledge(messageIds) {
    if (!Array.isArray(messageIds) || messageIds.some((value) => typeof value !== 'string')) {
      throw new Error('message_ids must be an array of strings.');
    }
    const wanted = new Set(messageIds);
    const messages = await this.list();
    let changed = 0;
    const updated = messages.map((message) => {
      if (wanted.has(message.message_id) && message.status === 'pending') {
        changed += 1;
        return { ...message, status: 'acknowledged', acknowledged_at: new Date().toISOString() };
      }
      return message;
    });
    await ensureDir(path.dirname(this.filePath));
    await writeFile(this.filePath, updated.map(JSON.stringify).join('\n') + (updated.length ? '\n' : ''), 'utf8');
    return changed;
  }
}
