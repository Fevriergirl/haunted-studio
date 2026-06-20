export function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

export function requireString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

export function requireArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value;
}

export function requireScore(value, name) {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(`${name} must be a number from 0 to 1.`);
  }
  return score;
}
