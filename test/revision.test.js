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
const baseExperiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));

test('curator can request one revision and preserve the event trail', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-revision-'));
  const experiment = structuredClone(baseExperiment);
  experiment.canon_threshold = 0.99;
  experiment.revision_threshold = 0.1;
  const studio = new Studio({ rootDir, constitution, experiment });
  const result = await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations });
  const events = await studio.ledger.readAll();
  assert.ok(events.some((event) => event.type === 'candidate_revised'));
  assert.ok(events.filter((event) => event.type === 'curation_decided').length >= 2);
  assert.equal(result.curation.decision, 'reject_all');
});
