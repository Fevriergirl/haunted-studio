import { requireArray, requireObject, requireScore, requireString } from '../core/validation.js';

const SCORE_KEYS = ['formal', 'truth', 'historical', 'adversarial_survival', 'surprise_potential'];

export async function runCriticPanel({ provider, candidates, intention, state, constitution }) {
  const critiques = [];
  for (const candidate of candidates) {
    const critique = requireObject(await provider.critiqueCandidate({ candidate, intention, state, constitution }), `critique:${candidate.id}`);
    if (critique.candidate_id !== candidate.id) {
      throw new Error(`Critic evaluated the wrong candidate. Expected ${candidate.id}, received ${critique.candidate_id}.`);
    }
    requireObject(critique.scores, `critique:${candidate.id}.scores`);
    if (critique.scores.surprise_potential === undefined && critique.scores.productive_surprise !== undefined) {
      critique.scores.surprise_potential = critique.scores.productive_surprise;
      delete critique.scores.productive_surprise;
    }
    for (const key of SCORE_KEYS) requireScore(critique.scores[key], `critique:${candidate.id}.scores.${key}`);
    requireScore(critique.confidence, `critique:${candidate.id}.confidence`);
    requireString(critique.strongest_objection, `critique:${candidate.id}.strongest_objection`);
    requireString(critique.revision, `critique:${candidate.id}.revision`);
    requireArray(critique.shortcut_findings, `critique:${candidate.id}.shortcut_findings`);
    critiques.push(critique);
  }
  return critiques;
}
