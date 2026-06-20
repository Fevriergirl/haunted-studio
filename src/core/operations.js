import { createHash } from 'node:crypto';
import path from 'node:path';
import { canonicalize } from './canonical-json.js';
import { id } from './ids.js';

const operationQueues = new Map();

export function operationScopePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function serializeOperation(key, operation) {
  const previous = operationQueues.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  operationQueues.set(key, current);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (operationQueues.get(key) === current) operationQueues.delete(key);
  }
}

export function operationFingerprint(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export function operationIdentity(value, prefix = 'operation') {
  if (value === undefined || value === null) return id(prefix);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('operation_id must be a non-empty string.');
  }
  return value.trim();
}

export function eventsForOperation(events, operationId) {
  return events.filter((event) => event.payload?.operation_id === operationId);
}

export function assertOperationCompatible(events, operationId, fingerprint) {
  const prior = eventsForOperation(events, operationId);
  if (prior.some((event) => event.payload?.operation_fingerprint !== fingerprint)) {
    throw new Error(`Operation conflict for ${operationId}: the recorded payload differs.`);
  }
  return prior;
}
