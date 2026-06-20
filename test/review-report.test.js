import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { recordHumanReview } from '../src/engine/human-review.js';
import { buildTrajectoryReport } from '../src/engine/report.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));

test('human review becomes audience evidence in the report', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-review-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const cycle = await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations });
  assert.ok(cycle.selected);
  const reviewPath = path.join(rootDir, 'input-review.json');
  await writeFile(reviewPath, JSON.stringify({
    reviewer_id: 'test-reviewer',
    consent: true,
    answers: {
      first_notice: 'the ordinary object',
      newly_visible: 'control as pressure',
      too_explained: 'the central clue',
      lingering_effect: 'the room felt less safe later'
    },
    ratings: { necessity: 4, depth: 5, decorative_risk: 2, return_desire: 4 }
  }));
  await recordHumanReview({ studio, cycleId: cycle.cycleId, reviewFile: reviewPath });
  const report = await buildTrajectoryReport({ studio });
  assert.equal(report.audience.review_count, 1);
  assert.equal(report.audience.average_ratings.depth, 5);
});
