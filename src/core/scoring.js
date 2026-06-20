export function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function weightedScore(scores, weights) {
  let numerator = 0;
  let denominator = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = Number(scores[key] ?? 0);
    numerator += clamp(value) * weight;
    denominator += weight;
  }
  return denominator === 0 ? 0 : clamp(numerator / denominator);
}

export function roundScore(value) {
  return Math.round(clamp(value) * 1000) / 1000;
}
