import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { AppendOnlyLedger } from '../src/core/ledger.js';
import { projectLedger } from '../src/core/projection.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { normalizeCandidatePlan } from '../src/engine/post-result-evidence.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));
const legacyFixture = path.join(cwd, 'test', 'fixtures', 'ledger-v0.jsonl');

class EvidenceFixtureProvider extends DeterministicProvider {
  constructor(scenario = 'none') {
    super();
    this.scenario = scenario;
    this.witnessCalls = [];
    this.comparisonCalls = [];
    this.reviewCalls = [];
  }

  async generateArtifact({ outputPath }) {
    await writeFile(outputPath, Buffer.from(`artifact:${this.scenario}`));
    return outputPath;
  }

  async witnessArtifact(input) {
    this.witnessCalls.push(structuredClone(input));
    const descriptions = {
      planned: 'The planned doubled edge is visible.',
      useful: 'An unplanned shadow joins two otherwise separate forms.',
      reject: 'An unplanned shadow joins two otherwise separate forms.',
      unsupported: 'A feature is asserted without visible support.',
      defect: 'A rectangular decoding block obscures the lower image.',
      noise: 'Unstructured pixel noise covers the frame.',
      unresolved: 'A faint edge may be structural or incidental.',
      none: 'The expected arrangement is present without additional features.'
    };
    return { observations: [{ description: descriptions[this.scenario], observable_support: this.scenario === 'unsupported' ? '' : 'artifact pixels', confidence: 0.9 }] };
  }

  async compareArtifactDeviation(input) {
    this.comparisonCalls.push(structuredClone(input));
    const classification = {
      planned: 'planned_variation',
      useful: 'potentially_productive_surprise',
      reject: 'potentially_productive_surprise',
      unsupported: 'potentially_productive_surprise',
      defect: 'technical_failure',
      noise: 'random_incoherence',
      unresolved: 'unresolved',
      none: 'expected_realization'
    }[this.scenario];
    return {
      comparisons: [{
        witness_evidence_id: input.witness.observations[0].evidence_id,
        classification,
        description: input.witness.observations[0].description,
        confidence: 0.88,
        explicitly_planned: this.scenario === 'planned',
        observable_support: this.scenario !== 'unsupported',
        coherent: !['noise', 'defect'].includes(this.scenario),
        material_interpretive_change: ['useful', 'reject'].includes(this.scenario),
        relates_to_work: ['useful', 'reject', 'planned'].includes(this.scenario)
      }]
    };
  }

  async reviewSurprise(input) {
    this.reviewCalls.push(structuredClone(input));
    const provisional = input.comparison.comparisons.filter((item) => item.classification === 'potentially_productive_surprise');
    return {
      reviews: provisional.map((item) => ({
        comparison_evidence_id: item.evidence_id,
        status: this.scenario === 'reject' ? 'rejected' : 'confirmed',
        confidence: 0.86,
        challenges: this.scenario === 'reject' ? ['The feature is common in prior work.'] : ['Not planned, trivial, incoherent, common, or technical.']
      })),
      no_productive_surprise: provisional.length === 0
    };
  }

  async inspectArtifact({ candidate }) {
    return {
      status: 'generated', candidate_id: candidate.id, overall_score: 0.9,
      recommended_action: 'accept_artifact', scores: {}, observations: [], failures: [], strongest_accident: null
    };
  }
}

async function artifactCycle(scenario, options = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), `haunted-evidence-${scenario}-`));
  const studio = new Studio({ rootDir, constitution, experiment });
  const provider = new EvidenceFixtureProvider(scenario);
  const result = await runCreativeCycle({
    studio, provider, observations, generateImage: true, features: { refusal: false },
    operationId: `operation_evidence_${scenario}_${path.basename(rootDir)}`,
    ...options
  });
  return { rootDir, studio, provider, result };
}

test('legacy proposed_accident is normalized as planned ambiguity, never discovered surprise', () => {
  const normalized = normalizeCandidatePlan({ proposed_accident: 'A doubled edge.' });
  assert.deepEqual(normalized.planned_ambiguities, ['A doubled edge.']);
  assert.equal(normalized.productive_surprise, undefined);
  assert.equal(normalized.legacy_source_field, 'proposed_accident');
});

test('witness blind pass excludes intention, plan, criticism, curation, audience, and memory', async () => {
  const { provider } = await artifactCycle('none');
  const input = provider.witnessCalls[0];
  for (const forbidden of ['intention', 'candidate', 'planned_ambiguity', 'proposed_accident', 'critique', 'curation', 'audience_prediction', 'memory']) {
    assert.equal(forbidden in input, false, `blind witness received ${forbidden}`);
  }
  assert.match(input.artifact_id, /^artifact_/);
  assert.match(input.artifact_hash, /^[a-f0-9]{64}$/);
});

test('planned ambiguity realized as expected is not promoted to productive surprise', async () => {
  const { result } = await artifactCycle('planned');
  assert.equal(result.postResultEvidence.confirmed_surprises.length, 0);
  assert.equal(result.postResultEvidence.comparisons[0].classification, 'planned_variation');
});

test('unsupported deviation, technical defect, and random incoherence are not productive surprise', async (t) => {
  for (const scenario of ['unsupported', 'defect', 'noise']) {
    await t.test(scenario, async () => {
      const { result } = await artifactCycle(scenario);
      assert.equal(result.postResultEvidence.confirmed_surprises.length, 0);
      assert.notEqual(result.postResultEvidence.comparisons[0].classification, 'productive_surprise');
    });
  }
});

test('meaningful unplanned feature is provisional until adversarial confirmation', async () => {
  const { result } = await artifactCycle('useful');
  assert.equal(result.postResultEvidence.comparisons[0].classification, 'potentially_productive_surprise');
  assert.equal(result.postResultEvidence.confirmed_surprises[0].classification, 'productive_surprise');
  assert.equal(result.postResultEvidence.confirmed_surprises[0].review_status, 'confirmed');
});

test('adversarial review can reject a provisional surprise', async () => {
  const { result } = await artifactCycle('reject');
  assert.equal(result.postResultEvidence.confirmed_surprises.length, 0);
  assert.equal(result.postResultEvidence.reviewed[0].classification, 'rejected_accident');
  assert.equal(result.postResultEvidence.reviewed[0].memory_eligible, false);
});

test('no productive surprise and unresolved deviation complete normally', async (t) => {
  for (const scenario of ['none', 'unresolved']) {
    await t.test(scenario, async () => {
      const { result } = await artifactCycle(scenario);
      assert.equal(result.state.cycle_count, 1);
      assert.equal(result.postResultEvidence.confirmed_surprises.length, 0);
    });
  }
});

test('conceptual-only cycle records evidence unavailable and cannot claim artifact surprise', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-conceptual-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const result = await runCreativeCycle({
    studio, provider: new DeterministicProvider(), observations, generateImage: false,
    features: { refusal: false }, operationId: 'operation_conceptual_evidence'
  });
  assert.equal(result.postResultEvidence.status, 'unavailable');
  assert.equal(result.postResultEvidence.confirmed_surprises.length, 0);
  assert.ok((await studio.ledger.readAll()).some((event) => event.type === 'post_result_evidence_unavailable'));
});

test('artifact hashes and linked evidence IDs are preserved', async () => {
  const { studio, result } = await artifactCycle('useful');
  const events = await studio.ledger.readAll();
  const artifact = events.find((event) => event.type === 'artifact_generated');
  const witness = events.find((event) => event.type === 'artifact_witnessed');
  const comparison = events.find((event) => event.type === 'artifact_deviations_compared');
  const review = events.find((event) => event.type === 'surprise_reviewed');
  assert.equal(witness.payload.artifact_hash, artifact.payload.artifact_hash);
  assert.equal(comparison.payload.witness_evidence_ids[0], witness.payload.observations[0].evidence_id);
  assert.equal(review.payload.comparison_evidence_id, comparison.payload.comparisons[0].evidence_id);
  assert.equal(result.postResultEvidence.confirmed_surprises[0].artifact_hash, artifact.payload.artifact_hash);
});

test('resume after each post-result boundary does not repeat persisted provider work or evidence', async (t) => {
  for (const boundary of ['artifact_witnessed', 'artifact_deviations_compared', 'surprise_reviewed']) {
    await t.test(boundary, async () => {
      const rootDir = await mkdtemp(path.join(os.tmpdir(), `haunted-evidence-resume-${boundary}-`));
      const studio = new Studio({ rootDir, constitution, experiment });
      const provider = new EvidenceFixtureProvider('useful');
      const operationId = `operation_resume_${boundary}`;
      await assert.rejects(runCreativeCycle({
        studio, provider, observations, generateImage: true, features: { refusal: false }, operationId, crashAfter: boundary
      }), /injected crash/i);
      const counts = [provider.witnessCalls.length, provider.comparisonCalls.length, provider.reviewCalls.length];
      const restarted = new Studio({ rootDir, constitution, experiment });
      const result = await runCreativeCycle({
        studio: restarted, provider, observations, generateImage: true, features: { refusal: false }, operationId, resume: true
      });
      assert.deepEqual([provider.witnessCalls.length, provider.comparisonCalls.length, provider.reviewCalls.length], [
        Math.max(counts[0], 1), Math.max(counts[1], 1), Math.max(counts[2], 1)
      ]);
      const events = await restarted.ledger.readAll();
      for (const type of ['artifact_witnessed', 'artifact_deviations_compared', 'surprise_reviewed']) {
        assert.equal(events.filter((event) => event.type === type).length, 1);
      }
      assert.equal(result.state.cycle_count, 1);
    });
  }
});

test('retry does not duplicate post-result evidence and replay equals live projection', async () => {
  const { studio, provider, result } = await artifactCycle('useful');
  const count = (await studio.ledger.readAll()).length;
  const repeated = await runCreativeCycle({
    studio, provider, observations, generateImage: true, features: { refusal: false }, operationId: result.operationId
  });
  assert.equal((await studio.ledger.readAll()).length, count);
  assert.deepEqual(repeated.state, projectLedger(await studio.ledger.readAll()));
});

test('invalid evidence order is rejected before persistence and surprise cannot precede artifact', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-order-'));
  const ledger = new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
  await ledger.append({ type: 'cycle_started', actor: 'test', cycleId: 'cycle_order', payload: {} });
  await assert.rejects(ledger.append({ type: 'surprise_reviewed', actor: 'test', cycleId: 'cycle_order', payload: {} }), /invalid lifecycle transition/i);
  assert.equal((await ledger.readAll()).some((event) => event.type === 'surprise_reviewed'), false);
});

test('post-result evidence in an incomplete cycle is not committed memory', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-incomplete-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const provider = new EvidenceFixtureProvider('useful');
  await assert.rejects(runCreativeCycle({
    studio, provider, observations, generateImage: true, features: { refusal: false },
    operationId: 'operation_incomplete_evidence', crashAfter: 'surprise_reviewed'
  }), /injected crash/i);
  const restarted = new Studio({ rootDir, constitution, experiment });
  const state = await restarted.initialize();
  assert.deepEqual(state.active_surprises, []);
  assert.equal(state.cycle_count, 0);
});

test('version-0 ledger remains readable and byte-for-byte unchanged', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-v0-'));
  const ledgerPath = path.join(directory, 'ledger.jsonl');
  await copyFile(legacyFixture, ledgerPath);
  const before = await readFile(ledgerPath, 'utf8');
  const ledger = new AppendOnlyLedger(ledgerPath);
  assert.equal((await ledger.verify()).valid, true);
  assert.equal(await readFile(ledgerPath, 'utf8'), before);
});
