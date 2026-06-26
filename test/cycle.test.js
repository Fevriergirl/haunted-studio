import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));

test('one creative cycle locks intention before candidate generation', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-cycle-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const result = await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations });
  assert.equal(result.verification.valid, true);
  assert.equal(result.state.cycle_count, 1);
  const events = await studio.ledger.readAll();
  const intentionIndex = events.findIndex((event) => event.type === 'intention_locked');
  const candidatesIndex = events.findIndex((event) => event.type === 'candidates_generated');
  assert.ok(intentionIndex >= 0);
  assert.ok(candidatesIndex > intentionIndex);
  assert.equal(result.intentionHash.length, 64);
  assert.equal(result.canonStatus, 'conceptual_only');
  assert.equal(result.artifactPath, null);
});

test('deterministic provider scoring is independent of the random cycle id', async () => {
  const provider = new DeterministicProvider();
  const observation = observations[0];
  const intention = await provider.lockIntention({ observation, necessity: {}, state: { cycle_count: 0 } });
  const generate = (cycleId) => provider.generateCandidates({ observation, intention, count: 3, cycleId, state: {} });
  const critiqueAll = (candidates) => Promise.all(candidates.map((candidate) =>
    provider.critiqueCandidate({ candidate, intention, state: {}, constitution })));

  const scoresA = (await critiqueAll(await generate('cycle_AAAAAAAA'))).map((critique) => critique.scores);
  const scoresB = (await critiqueAll(await generate('cycle_ZZZZZZZZ'))).map((critique) => critique.scores);
  // Different (random) cycle ids must not change the scores; otherwise curation
  // is nondeterministic and intermittently rejects all candidates.
  assert.deepEqual(scoresA, scoresB);
});

test('later cycles inherit motifs and unresolved tensions', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-cycle-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const provider = new DeterministicProvider();
  await runCreativeCycle({ studio, provider, observations });
  const second = await runCreativeCycle({ studio, provider, observations });
  assert.equal(second.state.cycle_count, 2);
  assert.ok(Object.keys(second.state.motifs).length > 0);
  assert.ok(second.state.unresolved_tensions.length > 0);
});

test('intention commitment is stable across event timestamps and separate from lock metadata', async () => {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'haunted-intention-first-'));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'haunted-intention-second-'));
  const firstStudio = new Studio({ rootDir: firstRoot, constitution, experiment });
  const secondStudio = new Studio({ rootDir: secondRoot, constitution, experiment });

  const first = await runCreativeCycle({
    studio: firstStudio,
    provider: new DeterministicProvider(),
    observations,
    cycleIdOverride: 'cycle_stable_commitment'
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await runCreativeCycle({
    studio: secondStudio,
    provider: new DeterministicProvider(),
    observations,
    cycleIdOverride: 'cycle_different_event_metadata'
  });

  assert.equal(first.intentionHash, second.intentionHash);
  const [firstLock] = (await firstStudio.ledger.readAll()).filter((event) => event.type === 'intention_locked');
  const [secondLock] = (await secondStudio.ledger.readAll()).filter((event) => event.type === 'intention_locked');
  assert.equal(firstLock.payload.intention_commitment, secondLock.payload.intention_commitment);
  assert.equal(firstLock.payload.intention_hash, firstLock.payload.intention_commitment);
  assert.notEqual(firstLock.payload.locked_at, secondLock.payload.locked_at);
});
