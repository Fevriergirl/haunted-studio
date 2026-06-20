import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fs.js';
import { id } from '../core/ids.js';

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function rating(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 5) {
    throw new Error(`${field} must be a number from 1 to 5.`);
  }
  return number;
}

export async function recordHumanReview({ studio, cycleId, reviewFile }) {
  const manifestPath = path.join(studio.cycleDirectory(cycleId), 'manifest.json');
  const manifest = await readJson(manifestPath);
  if (!manifest.selected_candidate) {
    throw new Error(`Cycle ${cycleId} has no accepted candidate to review.`);
  }

  const input = await readJson(reviewFile);
  if (input.consent !== true) {
    throw new Error('Review consent must be explicitly true.');
  }

  const review = {
    review_id: id('review'),
    cycle_id: cycleId,
    reviewer_id: requireText(input.reviewer_id ?? 'anonymous', 'reviewer_id'),
    recorded_at: new Date().toISOString(),
    consent: true,
    answers: {
      first_notice: requireText(input.answers?.first_notice, 'answers.first_notice'),
      newly_visible: requireText(input.answers?.newly_visible, 'answers.newly_visible'),
      too_explained: requireText(input.answers?.too_explained, 'answers.too_explained'),
      lingering_effect: requireText(input.answers?.lingering_effect, 'answers.lingering_effect')
    },
    ratings: {
      necessity: rating(input.ratings?.necessity, 'ratings.necessity'),
      depth: rating(input.ratings?.depth, 'ratings.depth'),
      decorative_risk: rating(input.ratings?.decorative_risk, 'ratings.decorative_risk'),
      return_desire: rating(input.ratings?.return_desire, 'ratings.return_desire')
    },
    notes: typeof input.notes === 'string' ? input.notes.trim() : ''
  };

  const reviewPath = path.join(studio.rootDir, 'reviews', cycleId, `${review.review_id}.json`);
  await writeJsonAtomic(reviewPath, review);
  await studio.ledger.append({
    type: 'human_review_recorded',
    actor: `human:${review.reviewer_id}`,
    cycleId,
    payload: review
  });

  const state = await studio.getState();
  const finding = {
    review_id: review.review_id,
    cycle_id: cycleId,
    predicted_first_notice: manifest.audience_prediction?.first_notice ?? null,
    actual_first_notice: review.answers.first_notice,
    likely_misreading: manifest.audience_prediction?.likely_misreading ?? null,
    too_explained: review.answers.too_explained,
    ratings: review.ratings
  };
  state.audience_findings = [...(state.audience_findings ?? []), finding];
  await studio.saveState(state);
  return { review, reviewPath, finding };
}
