import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppendOnlyLedger } from '../src/core/ledger.js';
import { Studio } from '../src/core/studio.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));
const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function temporaryLedger(prefix = 'haunted-lifecycle-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  return new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
}

async function appendEvent(ledger, cycleId, type, payload = {}) {
  return ledger.append({ type, actor: 'test', cycleId, payload });
}

async function appendSequence(ledger, cycleId, sequence) {
  for (const item of sequence) {
    const [type, payload = {}] = Array.isArray(item) ? item : [item, {}];
    await appendEvent(ledger, cycleId, type, payload);
  }
}

const acceptedPath = [
  'cycle_started',
  'observation_selected',
  'intention_locked',
  'candidates_generated',
  'critics_reported',
  ['curation_decided', { decision: 'accept', round: 0 }],
  'audience_predicted',
  'memory_consolidated'
];

const failurePrefixes = [
  ['cycle_started'],
  ['cycle_started', 'observation_selected'],
  ['cycle_started', 'observation_selected', 'intention_locked'],
  ['cycle_started', 'observation_selected', 'intention_locked', 'candidates_generated'],
  ['cycle_started', 'observation_selected', 'intention_locked', 'candidates_generated', 'critics_reported'],
  [...acceptedPath.slice(0, 6)],
  [...acceptedPath.slice(0, 6), 'candidate_revised'],
  [...acceptedPath.slice(0, 6), 'candidate_revised', 'revision_critiqued'],
  [...acceptedPath.slice(0, 6), 'candidate_revised', 'revision_critiqued', ['curation_decided', { decision: 'accept', round: 1 }]],
  [...acceptedPath.slice(0, 6), 'artifact_generated'],
  [...acceptedPath.slice(0, 6), 'artifact_generated', 'artifact_audited'],
  [...acceptedPath.slice(0, 6), 'artifact_generated', 'artifact_audited', 'artifact_audit_not_passed'],
  [...acceptedPath.slice(0, 7)],
  [...acceptedPath]
];

test('new events are versioned and legacy version-0 fixture remains readable', async () => {
  const ledger = await temporaryLedger();
  const event = await ledger.append({ type: 'studio_initialized', actor: 'test' });
  assert.equal(event.schema_version, 1);

  const legacyDirectory = await mkdtemp(path.join(os.tmpdir(), 'haunted-legacy-ledger-'));
  const legacyPath = path.join(legacyDirectory, 'ledger.jsonl');
  await copyFile(path.join(fixtureDirectory, 'ledger-v0.jsonl'), legacyPath);
  const legacyLedger = new AppendOnlyLedger(legacyPath);
  const legacyEvents = await legacyLedger.readAll();
  assert.equal(legacyEvents.length, 3);
  assert.ok(legacyEvents.every((item) => item.schema_version === undefined));
  assert.equal((await legacyLedger.verify()).valid, true);
});

test('event type, schema version, actor, and cycle identity are validated before persistence', async () => {
  const ledger = await temporaryLedger();
  await assert.rejects(
    ledger.append({ type: 'unknown_event', actor: 'test' }),
    /Unknown ledger event type/
  );
  await assert.rejects(
    ledger.append({ type: 'cycle_started', actor: 'test' }),
    /cycle identity/
  );
  await assert.rejects(
    ledger.append({ type: 'studio_initialized', actor: '', payload: {} }),
    /actor/
  );
  await assert.rejects(
    ledger.append({ type: 'studio_initialized', actor: 'test', schemaVersion: 0 }),
    /schema version/
  );
  assert.equal((await ledger.readAll()).length, 0);
});

test('the complete non-revision lifecycle can complete exactly once', async () => {
  const ledger = await temporaryLedger();
  const cycleId = 'cycle_complete';
  await appendSequence(ledger, cycleId, acceptedPath);
  await appendEvent(ledger, cycleId, 'cycle_completed');
  const terminal = (await ledger.readAll()).filter((event) => event.cycle_id === cycleId && event.type.startsWith('cycle_'));
  assert.deepEqual(terminal.map((event) => event.type).filter((type) => ['cycle_completed', 'cycle_failed'].includes(type)), ['cycle_completed']);
});

test('failure is legal from every nonterminal lifecycle phase', async (t) => {
  for (const [index, prefix] of failurePrefixes.entries()) {
    await t.test(`phase ${index + 1}: ${Array.isArray(prefix.at(-1)) ? prefix.at(-1)[0] : prefix.at(-1)}`, async () => {
      const ledger = await temporaryLedger();
      const cycleId = `cycle_failure_${index}`;
      await appendSequence(ledger, cycleId, prefix);
      await appendEvent(ledger, cycleId, 'cycle_failed', { name: 'Error', message: 'injected' });
      const terminal = (await ledger.readAll()).filter((event) =>
        event.cycle_id === cycleId && ['cycle_completed', 'cycle_failed'].includes(event.type)
      );
      assert.deepEqual(terminal.map((event) => event.type), ['cycle_failed']);
    });
  }
});

test('terminal events are rejected before start and completion is rejected before memory consolidation', async () => {
  const ledger = await temporaryLedger();
  await assert.rejects(appendEvent(ledger, 'cycle_missing', 'cycle_failed'), /cycle_started/);
  await assert.rejects(appendEvent(ledger, 'cycle_missing', 'cycle_completed'), /cycle_started/);

  const cycleId = 'cycle_early_completion';
  await appendSequence(ledger, cycleId, acceptedPath.slice(0, -1));
  await assert.rejects(appendEvent(ledger, cycleId, 'cycle_completed'), /memory_consolidated/);
});

test('duplicate locks, starts, terminal events, and ordinary events after terminal are rejected', async () => {
  const ledger = await temporaryLedger();
  const cycleId = 'cycle_duplicates';
  await appendSequence(ledger, cycleId, ['cycle_started', 'observation_selected', 'intention_locked']);
  await assert.rejects(appendEvent(ledger, cycleId, 'intention_locked'), /intention lock/);
  await assert.rejects(appendEvent(ledger, cycleId, 'cycle_started'), /already started/);

  await appendSequence(ledger, cycleId, acceptedPath.slice(3));
  await appendEvent(ledger, cycleId, 'cycle_completed');
  await assert.rejects(appendEvent(ledger, cycleId, 'cycle_completed'), /terminal/);
  await assert.rejects(appendEvent(ledger, cycleId, 'cycle_failed'), /terminal/);
  await assert.rejects(appendEvent(ledger, cycleId, 'audience_predicted'), /terminal/);
});

test('a failed cycle cannot later complete or fail again', async () => {
  const ledger = await temporaryLedger();
  const cycleId = 'cycle_failed_once';
  await appendEvent(ledger, cycleId, 'cycle_started');
  await appendEvent(ledger, cycleId, 'cycle_failed');
  await assert.rejects(appendEvent(ledger, cycleId, 'cycle_completed'), /terminal/);
  await assert.rejects(appendEvent(ledger, cycleId, 'cycle_failed'), /terminal/);
});

test('documented post-cycle event categories remain legal after completion', async () => {
  const ledger = await temporaryLedger();
  const cycleId = 'cycle_post_events';
  await appendSequence(ledger, cycleId, acceptedPath);
  await appendEvent(ledger, cycleId, 'cycle_completed');
  await appendEvent(ledger, cycleId, 'mailbox_observations_consumed');
  await appendEvent(ledger, cycleId, 'human_review_recorded');
  await appendEvent(ledger, cycleId, 'memory_corrected');
  assert.equal((await ledger.verify()).valid, true);
});

class SaveFailureAfterCompletionStudio extends Studio {
  async saveState(state) {
    const events = await this.ledger.readAll();
    if (events.some((event) => event.type === 'cycle_completed')) {
      throw new Error('injected projected-state save failure');
    }
    return super.saveState(state);
  }
}

test('a projected-state save failure after completion cannot add cycle_failed', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-save-failure-'));
  const studio = new SaveFailureAfterCompletionStudio({ rootDir, constitution, experiment });
  await assert.rejects(
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations }),
    /injected projected-state save failure/
  );
  const terminals = (await studio.ledger.readAll()).filter((event) => ['cycle_completed', 'cycle_failed'].includes(event.type));
  assert.deepEqual(terminals.map((event) => event.type), ['cycle_completed']);
});

test('a final verification failure after completion cannot add cycle_failed', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-verify-failure-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  studio.ledger.verify = async () => ({ valid: false, error: 'injected final verification failure' });
  await assert.rejects(
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations }),
    /injected final verification failure/
  );
  const terminals = (await studio.ledger.readAll()).filter((event) => ['cycle_completed', 'cycle_failed'].includes(event.type));
  assert.deepEqual(terminals.map((event) => event.type), ['cycle_completed']);
});
