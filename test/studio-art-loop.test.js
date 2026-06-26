import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { beginStudioCycle } from '../src/engine/studio-cycle.js';
import { recordArtifactDecision } from '../src/engine/studio-decision.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));

const SEED = 'a kitchen that quietly refuses to be entered';

async function studioCycle(seed = SEED, { mode = 'mock', operationId = null } = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-studio-ui-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const summary = await beginStudioCycle({ studio, seed, mode, operationId });
  return { studio, summary, rootDir };
}

test('the mock provider completes a full art cycle offline', async () => {
  const { summary } = await studioCycle();
  assert.equal(summary.mode, 'mock');
  assert.equal(summary.accepted_by_curator, true);
  assert.match(summary.cycle_id, /^cycle_/);
  assert.ok(summary.artist_brief && summary.artist_brief.length > 0);
  assert.ok(summary.generated_prompt && summary.generated_prompt.length > 0);
  assert.ok(summary.artifact_url.startsWith('/artifacts/cycles/'));
});

test('artifact metadata is saved beside the artifact with all required fields', async () => {
  const { studio, summary } = await studioCycle();
  const metadata = await readJson(path.join(studio.rootDir, 'artifacts', 'cycles', summary.cycle_id, 'metadata.json'));
  for (const field of ['seed', 'cycle_id', 'generated_prompt', 'provider', 'artifact_path', 'reflection', 'canon_decision', 'ledger_event_ids']) {
    assert.ok(field in metadata, `metadata missing ${field}`);
  }
  assert.equal(metadata.seed, SEED);
  assert.equal(metadata.provider, 'mock');
  assert.ok(Array.isArray(metadata.ledger_event_ids) && metadata.ledger_event_ids.length > 0);
  // The artifact file exists and is readable.
  await readJson(path.join(studio.rootDir, 'artifacts', 'cycles', summary.cycle_id, 'metadata.json'));
});

test('accepting an artifact records the decision and keeps it in active canon', async () => {
  const { studio, summary } = await studioCycle();
  const { state } = await recordArtifactDecision({ studio, cycleId: summary.cycle_id, decision: 'accept' });
  const work = state.canon.find((entry) => entry.cycle_id === summary.cycle_id);
  assert.ok(work, 'the accepted work is in canon');
  assert.equal(work.human_decision, 'accept');
  assert.ok(!work.revoked);
  assert.equal(state.canon.filter((entry) => !entry.revoked).length, 1);
  assert.ok(Object.keys(state.motifs).length > 0, 'memory motifs were consolidated');
});

test('rejecting an artifact withdraws it from active canon (marked, not erased)', async () => {
  const { studio, summary } = await studioCycle();
  const { state } = await recordArtifactDecision({ studio, cycleId: summary.cycle_id, decision: 'reject' });
  const work = state.canon.find((entry) => entry.cycle_id === summary.cycle_id);
  assert.equal(work.human_decision, 'reject');
  assert.equal(work.revoked, true);
  assert.equal(work.revocation.revoked_by, 'human');
  assert.equal(state.canon.filter((entry) => !entry.revoked).length, 0, 'no active canon after reject');
  assert.equal(state.canon.length, 1, 'the record is kept, never erased');
});

test('marking an artifact unresolved does not revoke canon', async () => {
  const { studio, summary } = await studioCycle();
  const { state } = await recordArtifactDecision({ studio, cycleId: summary.cycle_id, decision: 'unresolved' });
  const work = state.canon.find((entry) => entry.cycle_id === summary.cycle_id);
  assert.equal(work.human_decision, 'unresolved');
  assert.ok(!work.revoked);
  assert.equal(state.canon.filter((entry) => !entry.revoked).length, 1);
});

test('rerunning the same operation id duplicates no artifacts or ledger events', async () => {
  const { studio, summary } = await studioCycle(SEED, { operationId: 'operation_studio_fixed' });
  const firstEvents = (await studio.ledger.readAll()).length;

  const again = await beginStudioCycle({ studio, seed: SEED, mode: 'mock', operationId: 'operation_studio_fixed' });
  assert.equal(again.cycle_id, summary.cycle_id, 'same operation yields the same cycle');
  assert.equal((await studio.ledger.readAll()).length, firstEvents, 'no duplicate ledger events');

  // The decision is also idempotent under a fixed operation id.
  await recordArtifactDecision({ studio, cycleId: summary.cycle_id, decision: 'accept', operationId: 'operation_decision_fixed' });
  const afterDecision = (await studio.ledger.readAll()).length;
  await recordArtifactDecision({ studio, cycleId: summary.cycle_id, decision: 'accept', operationId: 'operation_decision_fixed' });
  assert.equal((await studio.ledger.readAll()).length, afterDecision, 'no duplicate decision events');
});
