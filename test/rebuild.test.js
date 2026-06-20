import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
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

test('state can be rebuilt from the ledger after projection loss', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-rebuild-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const cycle = await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations });
  await writeFile(path.join(rootDir, 'state.json'), JSON.stringify({ version: 1, cycle_count: 0 }));
  const rebuilt = await studio.rebuildStateFromLedger();
  assert.equal(rebuilt.cycle_count, 1);
  assert.equal(rebuilt.last_cycle_id, cycle.cycleId);
  assert.equal(rebuilt.canon.length + rebuilt.rejected.length, 1);
});
