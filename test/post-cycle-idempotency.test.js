import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { recordHumanReview } from '../src/engine/human-review.js';
import { recordMemoryCorrection } from '../src/engine/memory-correction.js';
import { recordMailboxConsumption } from '../src/engine/mailbox-consumption.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));

async function completedStudio(prefix) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const studio = new Studio({ rootDir, constitution, experiment });
  const cycle = await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId: `${prefix}_cycle` });
  return { rootDir, studio, cycle };
}

test('human-review append crash recovers and retry does not duplicate review evidence', async () => {
  const { rootDir, studio, cycle } = await completedStudio('haunted-review-retry-');
  const reviewFile = path.join(rootDir, 'review-input.json');
  await writeFile(reviewFile, JSON.stringify({
    consent: true,
    reviewer_id: 'reviewer-fixture',
    answers: {
      first_notice: 'The ordinary object.', newly_visible: 'A spatial contradiction.',
      too_explained: 'The title.', lingering_effect: 'Unresolved scale.'
    },
    ratings: { necessity: 4, depth: 3, decorative_risk: 2, return_desire: 4 }
  }));
  await assert.rejects(
    recordHumanReview({ studio, cycleId: cycle.cycleId, reviewFile, operationId: 'operation_review_retry', crashAfter: 'human_review_recorded' }),
    /injected crash/i
  );
  const restarted = new Studio({ rootDir, constitution, experiment });
  await restarted.initialize();
  const repeated = await recordHumanReview({ studio: restarted, cycleId: cycle.cycleId, reviewFile, operationId: 'operation_review_retry' });
  assert.equal(repeated.review.operation_id, 'operation_review_retry');
  assert.equal((await restarted.ledger.readAll()).filter((event) => event.type === 'human_review_recorded').length, 1);
  assert.equal((await restarted.getState()).audience_findings.length, 1);
  const changed = JSON.parse(await readFile(reviewFile, 'utf8'));
  changed.answers.first_notice = 'Conflicting answer.';
  await writeFile(reviewFile, JSON.stringify(changed));
  await assert.rejects(
    recordHumanReview({ studio: restarted, cycleId: cycle.cycleId, reviewFile, operationId: 'operation_review_retry' }),
    /operation conflict/i
  );
});

test('concurrent identical human reviews return the one recorded review', async () => {
  const { rootDir, studio, cycle } = await completedStudio('haunted-review-concurrent-');
  const reviewFile = path.join(rootDir, 'review-concurrent.json');
  await writeFile(reviewFile, JSON.stringify({
    consent: true,
    reviewer_id: 'concurrent-reviewer',
    answers: { first_notice: 'One.', newly_visible: 'Two.', too_explained: 'Three.', lingering_effect: 'Four.' },
    ratings: { necessity: 4, depth: 4, decorative_risk: 2, return_desire: 4 }
  }));
  const request = { studio, cycleId: cycle.cycleId, reviewFile, operationId: 'operation_review_concurrent' };
  const [first, repeated] = await Promise.all([recordHumanReview(request), recordHumanReview(request)]);
  assert.equal(repeated.review.review_id, first.review.review_id);
  assert.equal((await studio.ledger.readAll()).filter((event) => event.type === 'human_review_recorded').length, 1);
});

test('memory-correction append crash recovers and retry is idempotent', async () => {
  const { rootDir, studio } = await completedStudio('haunted-correction-retry-');
  const target = (await studio.ledger.readAll()).find((event) => event.type === 'memory_consolidated');
  const correctionFile = path.join(rootDir, 'correction-input.json');
  await writeFile(correctionFile, JSON.stringify({
    target_event_id: target.event_id,
    cycle_id: target.cycle_id,
    reason: 'Fixture correction.',
    corrected_interpretation: 'Typed fixture interpretation.'
  }));
  await assert.rejects(
    recordMemoryCorrection({ studio, correctionFile, operationId: 'operation_correction_retry', crashAfter: 'memory_corrected' }),
    /injected crash/i
  );
  const restarted = new Studio({ rootDir, constitution, experiment });
  await restarted.initialize();
  await recordMemoryCorrection({ studio: restarted, correctionFile, operationId: 'operation_correction_retry' });
  assert.equal((await restarted.ledger.readAll()).filter((event) => event.type === 'memory_corrected').length, 1);
  assert.equal((await restarted.getState()).corrections.length, 1);
});

test('mailbox consumption is idempotent and conflicting message sets are rejected', async () => {
  const { studio, cycle } = await completedStudio('haunted-mailbox-consumption-');
  const input = { studio, cycleId: cycle.cycleId, messageIds: ['message-1', 'message-2'], operationId: 'operation_mailbox_consumption' };
  const first = await recordMailboxConsumption(input);
  const repeated = await recordMailboxConsumption(input);
  assert.equal(repeated.event_id, first.event_id);
  assert.equal((await studio.ledger.readAll()).filter((event) => event.type === 'mailbox_observations_consumed').length, 1);
  await assert.rejects(recordMailboxConsumption({ ...input, messageIds: ['message-3'] }), /operation conflict/i);
});

test('mailbox-consumption append crash retries without duplicate records', async () => {
  const { studio, cycle } = await completedStudio('haunted-mailbox-consumption-crash-');
  const request = {
    studio, cycleId: cycle.cycleId, messageIds: ['message_b', 'message_a'],
    operationId: 'operation_mailbox_consumption_crash'
  };
  await assert.rejects(recordMailboxConsumption({ ...request, crashAfter: 'mailbox_observations_consumed' }), /injected crash/i);
  const event = await recordMailboxConsumption({ ...request, messageIds: ['message_a', 'message_b'] });
  assert.deepEqual(event.payload.message_ids, ['message_a', 'message_b']);
  assert.equal((await studio.ledger.readAll()).filter((item) => item.type === 'mailbox_observations_consumed').length, 1);
});
