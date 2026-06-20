import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalize } from './canonical-json.js';
import { ensureDir } from './fs.js';
import { id } from './ids.js';
import {
  CURRENT_EVENT_SCHEMA_VERSION,
  validateEventBeforeAppend,
  validateStoredVersionedEvent
} from './event-contract.js';

const GENESIS_HASH = '0'.repeat(64);
const appendQueues = new Map();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function ledgerKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function serializeAppend(filePath, operation) {
  const key = ledgerKey(filePath);
  const previous = appendQueues.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  appendQueues.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (appendQueues.get(key) === queued) appendQueues.delete(key);
  }
}

export class AppendOnlyLedger {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async readAll() {
    try {
      const text = await readFile(this.filePath, 'utf8');
      return text
        .split('\n')
        .filter(Boolean)
        .map((line, index) => {
          try {
            return JSON.parse(line);
          } catch (error) {
            throw new Error(`Ledger line ${index + 1} is invalid JSON: ${error.message}`);
          }
        });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async append({
    type,
    actor,
    cycleId = null,
    payload = {},
    schemaVersion = CURRENT_EVENT_SCHEMA_VERSION
  }) {
    return serializeAppend(this.filePath, async () => {
      const events = await this.readAll();
      validateEventBeforeAppend({ type, actor, cycleId, payload, schemaVersion }, events);
      const previous = events.at(-1);
      const unsigned = {
        event_id: id('evt'),
        schema_version: schemaVersion,
        sequence: events.length + 1,
        timestamp: new Date().toISOString(),
        type,
        actor,
        cycle_id: cycleId,
        payload,
        previous_hash: previous?.hash ?? GENESIS_HASH
      };
      const event = { ...unsigned, hash: sha256(canonicalize(unsigned)) };
      await ensureDir(path.dirname(this.filePath));
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
      return event;
    });
  }

  async verify() {
    const events = await this.readAll();
    let expectedPrevious = GENESIS_HASH;

    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.sequence !== index + 1) {
        return { valid: false, count: events.length, error: `Sequence mismatch at ${index + 1}` };
      }
      if (event.previous_hash !== expectedPrevious) {
        return { valid: false, count: events.length, error: `Broken chain at sequence ${event.sequence}` };
      }
      const { hash, ...unsigned } = event;
      const calculated = sha256(canonicalize(unsigned));
      if (calculated !== hash) {
        return { valid: false, count: events.length, error: `Hash mismatch at sequence ${event.sequence}` };
      }
      try {
        validateStoredVersionedEvent(event, events.slice(0, index));
      } catch (error) {
        return { valid: false, count: events.length, error: `Invalid event at sequence ${event.sequence}: ${error.message}` };
      }
      expectedPrevious = hash;
    }

    return {
      valid: true,
      count: events.length,
      head: events.at(-1)?.hash ?? GENESIS_HASH
    };
  }
}
