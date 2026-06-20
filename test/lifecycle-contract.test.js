import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
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
  [...acceptedPath.slice(0, 5), ['curation_decided', { decision: 'revise', round: 0 }], 'candidate_revised'],
  [...acceptedPath.slice(0, 5), ['curation_decided', { decision: 'revise', round: 0 }], 'candidate_revised', 'revision_critiqued'],
  [...acceptedPath.slice(0, 5), ['curation_decided', { decision: 'revise', round: 0 }], 'candidate_revised', 'revision_critiqued', ['curation_decided', { decision: 'accept', round: 1 }]],
  [...acceptedPath.slice(0, 5), ['curation_decided', { decision: 'reject_all', round: 0 }], ['curation_overridden_by_condition', { decision: 'accept' }]],
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

  const originalBytes = await readFile(legacyPath, 'utf8');
  const appended = await legacyLedger.append({
    type: 'memory_corrected',
    actor: 'test',
    cycleId: 'cycle_legacy',
    payload: { target_event_id: 'evt_legacy_failed' }
  });
  const mixedBytes = await readFile(legacyPath, 'utf8');
  assert.ok(mixedBytes.startsWith(originalBytes));
  assert.equal(appended.schema_version, 1);
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

test('completion is rejected from every lifecycle phase before memory consolidation', async (t) => {
  for (const [index, prefix] of failurePrefixes.slice(0, -1).entries()) {
    await t.test(`phase ${index + 1}`, async () => {
      const ledger = await temporaryLedger();
      const cycleId = `cycle_early_completion_${index}`;
      await appendSequence(ledger, cycleId, prefix);
      await assert.rejects(appendEvent(ledger, cycleId, 'cycle_completed'), /memory_consolidated/);
    });
  }
});

test('curation decisions constrain revision, artifact, and audience transitions', async (t) => {
  async function ledgerAtDecision(decision) {
    const ledger = await temporaryLedger();
    const cycleId = `cycle_decision_${decision}`;
    await appendSequence(ledger, cycleId, [
      'cycle_started',
      'observation_selected',
      'intention_locked',
      'candidates_generated',
      'critics_reported',
      ['curation_decided', { decision, round: 0 }]
    ]);
    return { ledger, cycleId };
  }

  await t.test('accept permits artifact and audience paths but not revision', async () => {
    const { ledger, cycleId } = await ledgerAtDecision('accept');
    await assert.rejects(appendEvent(ledger, cycleId, 'candidate_revised'), /accept/);
    await appendEvent(ledger, cycleId, 'artifact_generated');
  });

  await t.test('revise permits revision but not artifact, audience, or memory', async () => {
    for (const disallowed of ['artifact_generated', 'audience_predicted', 'memory_consolidated']) {
      const { ledger, cycleId } = await ledgerAtDecision('revise');
      await assert.rejects(appendEvent(ledger, cycleId, disallowed), /revise/);
    }
    const { ledger, cycleId } = await ledgerAtDecision('revise');
    await appendEvent(ledger, cycleId, 'candidate_revised');
  });

  await t.test('reject_all permits memory or explicit acceptance override, not artifact or audience', async () => {
    for (const disallowed of ['candidate_revised', 'artifact_generated', 'audience_predicted']) {
      const { ledger, cycleId } = await ledgerAtDecision('reject_all');
      await assert.rejects(appendEvent(ledger, cycleId, disallowed), /reject_all/);
    }
    const rejected = await ledgerAtDecision('reject_all');
    await appendEvent(rejected.ledger, rejected.cycleId, 'memory_consolidated');
    const overridden = await ledgerAtDecision('reject_all');
    await appendEvent(overridden.ledger, overridden.cycleId, 'curation_overridden_by_condition', { decision: 'accept' });
    await appendEvent(overridden.ledger, overridden.cycleId, 'audience_predicted');
  });

  await t.test('a final curation decision cannot request another revision', async () => {
    const { ledger, cycleId } = await ledgerAtDecision('revise');
    await appendSequence(ledger, cycleId, ['candidate_revised', 'revision_critiqued']);
    await assert.rejects(
      appendEvent(ledger, cycleId, 'curation_decided', { decision: 'revise', round: 1 }),
      /final curation/
    );
  });
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

test('concurrent terminal attempts serialize so exactly one outcome is persisted', async () => {
  const ledger = await temporaryLedger();
  const cycleId = 'cycle_concurrent_terminal';
  await appendSequence(ledger, cycleId, acceptedPath);

  const results = await Promise.allSettled([
    appendEvent(ledger, cycleId, 'cycle_completed'),
    appendEvent(ledger, cycleId, 'cycle_failed', { name: 'Error', message: 'concurrent failure' })
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);

  const terminals = (await ledger.readAll()).filter((event) =>
    event.cycle_id === cycleId && ['cycle_completed', 'cycle_failed'].includes(event.type)
  );
  assert.equal(terminals.length, 1);
  assert.equal((await ledger.verify()).valid, true);
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
  const originalVerify = studio.ledger.verify.bind(studio.ledger);
  studio.ledger.verify = async () => {
    const events = await studio.ledger.readAll();
    return events.some((event) => event.type === 'cycle_completed')
      ? { valid: false, error: 'injected final verification failure' }
      : originalVerify();
  };
  await assert.rejects(
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations }),
    /injected final verification failure/
  );
  const terminals = (await studio.ledger.readAll()).filter((event) => ['cycle_completed', 'cycle_failed'].includes(event.type));
  assert.deepEqual(terminals.map((event) => event.type), ['cycle_completed']);
});
