import path from 'node:path';
import { readJson, writeJsonAtomic } from '../core/fs.js';
import { id } from '../core/ids.js';
import { assertOperationCompatible, operationFingerprint, operationIdentity, operationScopePath, serializeOperation } from '../core/operations.js';
import { maybeInjectCrash } from '../core/crash-injection.js';

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

function rating(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 5) throw new Error(`${field} must be a number from 1 to 5.`);
  return number;
}

function normalizedReview(input, cycleId) {
  if (input.consent !== true) throw new Error('Review consent must be explicitly true.');
  return {
    cycle_id: cycleId,
    reviewer_id: requireText(input.reviewer_id ?? 'anonymous', 'reviewer_id'),
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
}

export async function recordHumanReview(options) {
  const resolvedOperationId = operationIdentity(options.operationId, 'review-operation');
  return serializeOperation(`studio-write:${operationScopePath(options.studio.rootDir)}`, () =>
    recordHumanReviewUnlocked({ ...options, operationId: resolvedOperationId }));
}

async function recordHumanReviewUnlocked({ studio, cycleId, reviewFile, operationId, crashAfter = null }) {
  await studio.initialize();
  const events = await studio.ledger.readAll();
  const manifest = events.find((event) => event.type === 'cycle_completed' && event.cycle_id === cycleId)?.payload;
  if (!manifest) throw new Error(`Cycle ${cycleId} is not completed.`);
  if (!manifest.selected_candidate) throw new Error(`Cycle ${cycleId} has no accepted candidate to review.`);
  const normalized = normalizedReview(await readJson(reviewFile), cycleId);
  const resolvedOperationId = operationId;
  const fingerprint = operationFingerprint({ kind: 'human_review', ...normalized });
  const prior = assertOperationCompatible(events, resolvedOperationId, fingerprint)
    .find((event) => event.type === 'human_review_recorded');
  if (prior) {
    const state = await studio.projectAndSave('idempotent_review_retry');
    const review = prior.payload.review ?? prior.payload;
    return { review, reviewPath: path.join(studio.rootDir, 'reviews', cycleId, `${review.review_id}.json`), finding: state.audience_findings.find((item) => item.review_id === review.review_id) };
  }

  const review = {
    ...normalized,
    review_id: id('review'),
    operation_id: resolvedOperationId,
    recorded_at: new Date().toISOString()
  };
  const reviewPath = path.join(studio.rootDir, 'reviews', cycleId, `${review.review_id}.json`);
  await writeJsonAtomic(reviewPath, review);
  await studio.ledger.append({
    type: 'human_review_recorded',
    actor: `human:${review.reviewer_id}`,
    cycleId,
    payload: { operation_id: resolvedOperationId, operation_fingerprint: fingerprint, review }
  });
  maybeInjectCrash(crashAfter, 'human_review_recorded');
  const state = await studio.projectAndSave();
  return { review, reviewPath, finding: state.audience_findings.find((item) => item.review_id === review.review_id) };
}
