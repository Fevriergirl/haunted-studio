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
