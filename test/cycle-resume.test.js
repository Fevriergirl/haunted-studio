import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { abandonCycle } from '../src/engine/recovery.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const baseExperiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));

class ArtifactProvider extends DeterministicProvider {
  constructor({ score = 0.9, action = 'accept_artifact' } = {}) {
    super();
    this.generateCount = 0;
    this.auditCount = 0;
    this.score = score;
    this.action = action;
  }

  async generateArtifact({ outputPath }) {
    this.generateCount += 1;
    await writeFile(outputPath, Buffer.from('artifact-fixture'));
    return outputPath;
  }

  async inspectArtifact({ candidate }) {
    this.auditCount += 1;
    return {
      status: 'generated', candidate_id: candidate.id, overall_score: this.score,
      recommended_action: this.action, scores: {}, observations: [], failures: [], strongest_accident: null
    };
  }
}

class RejectingCuratorProvider extends DeterministicProvider {
  async curate({ candidates }) {
    return {
      decision: 'reject_all', selected_candidate_id: null, score: 0, threshold: 1,
      revision_threshold: 1, rationale: 'Fixture rejection.', conditions: [],
      ranking: candidates.map((candidate) => ({ candidate_id: candidate.id, score: 0, penalty: 0 }))
    };
  }
}

class ResumeContextProvider extends DeterministicProvider {
  async formNecessity(context) {
    const result = await super.formNecessity(context);
    return { ...result, statement: `${result.statement} incomplete=${context.state.incomplete_cycles?.length ?? 0}` };
  }
}

async function scenarioFor(boundary) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), `haunted-crash-${boundary}-`));
  const experiment = structuredClone(baseExperiment);
  let provider = new DeterministicProvider();
  let generateImage = false;
  let features = {};
  if (['candidate_revised', 'revision_critiqued', 'final_curation_decided'].includes(boundary)) {
    experiment.canon_threshold = 0.99;
    experiment.revision_threshold = 0.1;
  }
  if (boundary === 'curation_overridden_by_condition') {
    provider = new RejectingCuratorProvider();
    features = { refusal: false };
  }
  if (['artifact_generated', 'artifact_audited', 'artifact_audit_not_passed'].includes(boundary)) {
    provider = new ArtifactProvider();
    if (boundary === 'artifact_audit_not_passed') provider = new ArtifactProvider({ score: 0.2, action: 'reject_artifact' });
    generateImage = true;
  }
  return { rootDir, experiment, provider, generateImage, features, studio: new Studio({ rootDir, constitution, experiment }) };
}

const cycleBoundaries = [
  'cycle_started', 'observation_selected', 'intention_locked', 'candidates_generated',
  'critics_reported', 'curation_decided', 'curation_overridden_by_condition',
  'candidate_revised', 'revision_critiqued', 'final_curation_decided', 'artifact_generated',
  'artifact_audited', 'artifact_audit_not_passed', 'audience_predicted',
  'memory_consolidated', 'cycle_completed', 'state_saved'
];

test('each cycle persistence boundary supports restart without duplicate effects', async (t) => {
  for (const boundary of cycleBoundaries) {
    await t.test(boundary, async () => {
      const scenario = await scenarioFor(boundary);
      const operationId = `operation_crash_${boundary}`;
      await assert.rejects(
        runCreativeCycle({
          studio: scenario.studio,
          provider: scenario.provider,
          observations,
          generateImage: scenario.generateImage,
          features: scenario.features,
          operationId,
          crashAfter: boundary
        }),
        /injected crash/i
      );
      const before = await scenario.studio.ledger.readAll();
      const restarted = new Studio({ rootDir: scenario.rootDir, constitution, experiment: scenario.experiment });
      await restarted.initialize();
      const completed = before.some((event) => event.type === 'cycle_completed');
      const result = await runCreativeCycle({
        studio: restarted,
        provider: scenario.provider,
        observations,
        generateImage: scenario.generateImage,
        features: scenario.features,
        operationId,
        resume: !completed
      });
      assert.equal(result.state.cycle_count, 1);
      const after = await restarted.ledger.readAll();
      assert.equal(after.filter((event) => event.type === 'cycle_completed').length, 1);
      assert.equal(after.filter((event) => event.type === 'cycle_failed').length, 0);
      for (const event of before.filter((item) => item.cycle_id === result.cycleId)) {
        assert.equal(after.filter((item) => item.event_id === event.event_id).length, 1);
      }
      assert.equal((await restarted.ledger.verify()).valid, true);
      if (boundary === 'artifact_generated') assert.equal(scenario.provider.generateCount, 1);
      if (boundary === 'artifact_audited') {
        assert.equal(scenario.provider.generateCount, 1);
        assert.equal(scenario.provider.auditCount, 1);
      }
    });
  }
});

test('completed cycle retry is a no-op and conflicting payload is rejected', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-cycle-idempotency-'));
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  const operationId = 'operation_completed_retry';
  const first = await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId });
  const count = (await studio.ledger.readAll()).length;
  const repeated = await runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId });
  assert.equal(repeated.cycleId, first.cycleId);
  assert.equal((await studio.ledger.readAll()).length, count);
  await assert.rejects(
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations: observations.slice(1), operationId }),
    /operation conflict/i
  );
});

test('cycle identity cannot be adopted by a different operation', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-cycle-ownership-'));
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  await runCreativeCycle({
    studio, provider: new DeterministicProvider(), observations,
    operationId: 'operation_owner_a', cycleIdOverride: 'cycle_owned'
  });
  await assert.rejects(
    runCreativeCycle({
      studio, provider: new DeterministicProvider(), observations,
      operationId: 'operation_owner_b', cycleIdOverride: 'cycle_owned'
    }),
    /cycle identity conflict/i
  );
});

test('concurrent identical cycle requests return one logical result', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-cycle-concurrent-retry-'));
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  const request = {
    studio, provider: new DeterministicProvider(), observations,
    operationId: 'operation_concurrent_cycle', cycleIdOverride: 'cycle_concurrent_retry'
  };
  const [first, repeated] = await Promise.all([runCreativeCycle(request), runCreativeCycle(request)]);
  assert.equal(repeated.cycleId, first.cycleId);
  const events = await studio.ledger.readAll();
  assert.equal(events.filter((event) => event.type === 'cycle_started').length, 1);
  assert.equal(events.filter((event) => event.type === 'cycle_completed').length, 1);
});

test('concurrent distinct cycle operations serialize against the latest projection', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-cycle-concurrent-distinct-'));
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  const [first, second] = await Promise.all([
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId: 'operation_concurrent_a' }),
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId: 'operation_concurrent_b' })
  ]);
  assert.notEqual(first.cycleId, second.cycleId);
  const state = await studio.getState();
  assert.equal(state.cycle_count, 2);
  assert.equal(Object.values(state.observation_counts).reduce((sum, count) => sum + count, 0), 2);
  assert.deepEqual(state, await (await import('../src/core/projection.js')).projectLedger(await studio.ledger.readAll()));
});

test('incomplete cycle requires explicit resume and preserves its intention commitment', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-explicit-resume-'));
  const operationId = 'operation_explicit_resume';
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  await assert.rejects(
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId, crashAfter: 'intention_locked' }),
    /injected crash/i
  );
  const originalLock = (await studio.ledger.readAll()).find((event) => event.type === 'intention_locked');
  const restarted = new Studio({ rootDir, constitution, experiment: baseExperiment });
  await assert.rejects(
    runCreativeCycle({ studio: restarted, provider: new DeterministicProvider(), observations, operationId }),
    /explicit resume/i
  );
  const resumed = await runCreativeCycle({ studio: restarted, provider: new DeterministicProvider(), observations, operationId, resume: true });
  const locks = (await restarted.ledger.readAll()).filter((event) => event.type === 'intention_locked');
  assert.equal(locks.length, 1);
  assert.equal(resumed.intentionHash, originalLock.payload.intention_commitment);
});

test('explicit abandonment terminates an incomplete operation idempotently', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-abandon-'));
  const operationId = 'operation_to_abandon';
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  await assert.rejects(
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId, crashAfter: 'cycle_started' }),
    /injected crash/i
  );
  const first = await abandonCycle({ studio, operationId, abandonmentOperationId: 'operation_abandon_request' });
  const count = (await studio.ledger.readAll()).length;
  const repeated = await abandonCycle({ studio, operationId, abandonmentOperationId: 'operation_abandon_request' });
  assert.equal(repeated.event_id, first.event_id);
  assert.equal((await studio.ledger.readAll()).length, count);
  assert.equal((await studio.getState()).incomplete_cycles.length, 0);
});

test('resume uses the original pre-cycle projection and rejects changed constitution', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-resume-context-'));
  const operationId = 'operation_resume_context';
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  await assert.rejects(
    runCreativeCycle({ studio, provider: new ResumeContextProvider(), observations, operationId, crashAfter: 'cycle_started' }),
    /injected crash/i
  );
  const restarted = new Studio({ rootDir, constitution, experiment: baseExperiment });
  const resumed = await runCreativeCycle({
    studio: restarted, provider: new ResumeContextProvider(), observations, operationId, resume: true
  });
  assert.match(resumed.necessity.statement, /incomplete=0$/);

  const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'haunted-resume-constitution-'));
  const second = new Studio({ rootDir: secondRoot, constitution, experiment: baseExperiment });
  await assert.rejects(
    runCreativeCycle({ second, studio: second, provider: new DeterministicProvider(), observations, operationId: 'operation_constitution', crashAfter: 'cycle_started' }),
    /injected crash/i
  );
  second.constitution = { ...constitution, version: 'changed-version' };
  await assert.rejects(
    runCreativeCycle({ studio: second, provider: new DeterministicProvider(), observations, operationId: 'operation_constitution', resume: true }),
    /operation conflict/i
  );
});

test('legacy incomplete cycle can be explicitly abandoned by cycle identity', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-legacy-incomplete-'));
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  await studio.initialize();
  const cycleId = 'cycle_legacy_incomplete';
  await studio.ledger.append({ type: 'cycle_started', actor: 'legacy', cycleId, payload: {} });
  const restarted = new Studio({ rootDir, constitution, experiment: baseExperiment });
  await restarted.initialize();
  const event = await abandonCycle({
    studio: restarted,
    cycleId,
    abandonmentOperationId: 'operation_abandon_legacy'
  });
  assert.equal(event.type, 'cycle_failed');
  assert.equal(event.cycle_id, cycleId);
});

test('abandonment append crash is recovered idempotently', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-abandon-crash-'));
  const studio = new Studio({ rootDir, constitution, experiment: baseExperiment });
  const operationId = 'operation_abandon_crash_cycle';
  await assert.rejects(
    runCreativeCycle({ studio, provider: new DeterministicProvider(), observations, operationId, crashAfter: 'cycle_started' }),
    /injected crash/i
  );
  await assert.rejects(
    abandonCycle({ studio, operationId, abandonmentOperationId: 'operation_abandon_crash', crashAfter: 'cycle_failed' }),
    /injected crash/i
  );
  const event = await abandonCycle({ studio, operationId, abandonmentOperationId: 'operation_abandon_crash' });
  assert.equal(event.type, 'cycle_failed');
  assert.equal((await studio.ledger.readAll()).filter((item) => item.type === 'cycle_failed').length, 1);
});
