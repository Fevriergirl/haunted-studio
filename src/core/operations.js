import { createHash } from 'node:crypto';
import { canonicalize } from './canonical-json.js';
import { id } from './ids.js';

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
