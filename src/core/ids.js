import { randomUUID } from 'node:crypto';

export function id(prefix) {
  return `${prefix}_${randomUUID()}`;
}
