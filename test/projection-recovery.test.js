import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function studioFixture(prefix = 'haunted-projection-') {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { rootDir, studio: new Studio({ rootDir, constitution, experiment }) };
}

test('live projection and repeated full replay are canonically deep-equal', async () => {
  const { studio } = await studioFixture();
  await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId: 'operation_projection_equality' });
  const live = await studio.getState();
  const once = await studio.rebuildStateFromLedger();
  const twice = await studio.rebuildStateFromLedger();
  assert.deepEqual(once, live);
  assert.deepEqual(twice, live);
  const head = (await studio.ledger.readAll()).at(-1);
  assert.deepEqual(live.ledger_head, {
    sequence: head.sequence,
    event_id: head.event_id,
    event_hash: head.hash,
    schema_version: head.schema_version
  });
});

test('missing state is rebuilt from a valid ledger without rewriting history', async () => {
  const { rootDir, studio } = await studioFixture();
  await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId: 'operation_missing_state' });
  const ledgerPath = path.join(rootDir, 'ledger.jsonl');
  const before = await readFile(ledgerPath, 'utf8');
  await rm(path.join(rootDir, 'state.json'));
  const restarted = new Studio({ rootDir, constitution, experiment });
  const rebuilt = await restarted.initialize();
  assert.equal(rebuilt.cycle_count, 1);
  assert.equal(restarted.lastProjectionStatus.action, 'missing_state_rebuilt');
  assert.equal(await readFile(ledgerPath, 'utf8'), before);
});

test('a stale state at a valid earlier head is rebuilt and reported', async () => {
  const { rootDir, studio } = await studioFixture();
  const initial = await studio.initialize();
  await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId: 'operation_stale_state' });
  const ledgerPath = path.join(rootDir, 'ledger.jsonl');
  const before = await readFile(ledgerPath, 'utf8');
  await writeFile(path.join(rootDir, 'state.json'), `${JSON.stringify(initial, null, 2)}\n`);
  const restarted = new Studio({ rootDir, constitution, experiment });
  const rebuilt = await restarted.initialize();
  assert.equal(rebuilt.cycle_count, 1);
  assert.equal(restarted.lastProjectionStatus.action, 'stale_state_rebuilt');
  assert.equal(await readFile(ledgerPath, 'utf8'), before);
});

test('state ahead of or divergent from the ledger is rejected', async (t) => {
  await t.test('ahead', async () => {
    const { rootDir, studio } = await studioFixture('haunted-ahead-');
    const state = await studio.initialize();
    state.ledger_head.sequence += 1;
    await studio.saveState(state);
    await assert.rejects(new Studio({ rootDir, constitution, experiment }).initialize(), /ahead of ledger/i);
  });
  await t.test('divergent identity', async () => {
    const { rootDir, studio } = await studioFixture('haunted-divergent-');
    const state = await studio.initialize();
    state.ledger_head.event_hash = 'f'.repeat(64);
    await studio.saveState(state);
    await assert.rejects(new Studio({ rootDir, constitution, experiment }).initialize(), /divergent/i);
  });
});

test('an invalid ledger stops startup without rebuilding state', async () => {
  const { rootDir, studio } = await studioFixture('haunted-invalid-ledger-');
  await studio.initialize();
  const ledgerPath = path.join(rootDir, 'ledger.jsonl');
  const events = (await readFile(ledgerPath, 'utf8')).trim().split('\n').map(JSON.parse);
  events[0].payload.experiment_name = 'tampered';
  await writeFile(ledgerPath, `${events.map(JSON.stringify).join('\n')}\n`);
  const stateBefore = await readFile(path.join(rootDir, 'state.json'), 'utf8');
  await assert.rejects(new Studio({ rootDir, constitution, experiment }).initialize(), /ledger integrity/i);
  assert.equal(await readFile(path.join(rootDir, 'state.json'), 'utf8'), stateBefore);
});

test('legacy state without a ledger head follows the explicit compatibility rebuild', async () => {
  const { rootDir, studio } = await studioFixture('haunted-legacy-state-');
  await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId: 'operation_legacy_state' });
  await writeFile(path.join(rootDir, 'state.json'), `${JSON.stringify({ version: 1, cycle_count: 99 })}\n`);
  const restarted = new Studio({ rootDir, constitution, experiment });
  const rebuilt = await restarted.initialize();
  assert.equal(rebuilt.cycle_count, 1);
  assert.equal(restarted.lastProjectionStatus.action, 'legacy_state_rebuilt');
});

test('matching head with altered projection content is rebuilt', async () => {
  const { rootDir, studio } = await studioFixture('haunted-content-mismatch-');
  const state = await studio.initialize();
  state.canon.push({ fabricated: true });
  await studio.saveState(state);
  const restarted = new Studio({ rootDir, constitution, experiment });
  const rebuilt = await restarted.initialize();
  assert.deepEqual(rebuilt.canon, []);
  assert.equal(restarted.lastProjectionStatus.action, 'content_mismatch_rebuilt');
});

test('incomplete-cycle memory remains provenance and is not committed projection', async () => {
  const { rootDir, studio } = await studioFixture('haunted-incomplete-projection-');
  await studio.initialize();
  const cycleId = 'cycle_incomplete_memory';
  const events = [
    ['cycle_started', { operation_id: 'operation_incomplete_memory', operation_fingerprint: 'fixture' }],
    ['observation_selected', {}],
    ['intention_locked', {}],
    ['candidates_generated', {}],
    ['critics_reported', {}],
    ['curation_decided', { decision: 'accept', round: 0 }],
    ['memory_consolidated', { motifs: { fabricated: 12 }, observation_counts: { fabricated: 12 }, active_surprises: [{ description: 'not committed' }], unresolved_tensions: ['not committed'] }]
  ];
  for (const [type, payload] of events) await studio.ledger.append({ type, actor: 'test', cycleId, payload });
  const restarted = new Studio({ rootDir, constitution, experiment });
  const state = await restarted.initialize();
  assert.deepEqual(state.motifs, {});
  assert.deepEqual(state.active_surprises, []);
  assert.equal(state.cycle_count, 0);
  assert.deepEqual(state.incomplete_cycles.map((item) => item.cycle_id), [cycleId]);
  await assert.rejects(
    runCreativeCycle({ studio: restarted, provider: new DeterministicProvider(), observations, operationId: 'operation_unrelated' }),
    /incomplete cycle/i
  );
});
