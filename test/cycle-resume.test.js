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
  constructor() {
    super();
    this.generateCount = 0;
    this.auditCount = 0;
  }

  async generateArtifact({ outputPath }) {
    this.generateCount += 1;
    await writeFile(outputPath, Buffer.from('artifact-fixture'));
    return outputPath;
  }

  async inspectArtifact({ candidate }) {
    this.auditCount += 1;
    return {
      status: 'generated', candidate_id: candidate.id, overall_score: 0.9,
      recommended_action: 'accept_artifact', scores: {}, observations: [], failures: [], strongest_accident: null
    };
  }
}

async function scenarioFor(boundary) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), `haunted-crash-${boundary}-`));
  const experiment = structuredClone(baseExperiment);
  let provider = new DeterministicProvider();
  let generateImage = false;
  if (boundary === 'candidate_revised') {
    experiment.canon_threshold = 0.99;
    experiment.revision_threshold = 0.1;
  }
  if (['artifact_generated', 'artifact_audited'].includes(boundary)) {
    provider = new ArtifactProvider();
    generateImage = true;
  }
  return { rootDir, experiment, provider, generateImage, studio: new Studio({ rootDir, constitution, experiment }) };
}

const cycleBoundaries = [
  'cycle_started', 'observation_selected', 'intention_locked', 'candidates_generated',
  'critics_reported', 'curation_decided', 'candidate_revised', 'artifact_generated',
  'artifact_audited', 'audience_predicted', 'memory_consolidated', 'cycle_completed', 'state_saved'
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
