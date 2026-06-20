import test from 'node:test';
import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Studio } from '../src/core/studio.js';
import { AppendOnlyLedger } from '../src/core/ledger.js';
import { projectLedger } from '../src/core/projection.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { normalizeCandidatePlan } from '../src/engine/post-result-evidence.js';
import { abandonCycle } from '../src/engine/recovery.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { readJson } from '../src/core/fs.js';
import { canonicalize } from '../src/core/canonical-json.js';

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
      planned_misclassified: 'The candidate plan appears in the artifact.',
      anticipated_misclassified: 'The anticipated failure mode appears in the artifact.',
      weak_review: 'An unplanned shadow joins two otherwise separate forms.',
      useful: 'An unplanned shadow joins two otherwise separate forms.',
      reject: 'An unplanned shadow joins two otherwise separate forms.',
      unsupported: 'A feature is asserted without visible support.',
      defect: 'A rectangular decoding block obscures the lower image.',
      noise: 'Unstructured pixel noise covers the frame.',
      unresolved: 'A faint edge may be structural or incidental.',
      none: 'The expected arrangement is present without additional features.'
    };
    return { observations: [{ description: descriptions[this.scenario], observable_support: this.scenario === 'unsupported' ? 'inspection found no matching pixels' : 'artifact pixels', confidence: 0.9 }] };
  }

  async compareArtifactDeviation(input) {
    this.comparisonCalls.push(structuredClone(input));
    const classification = {
      planned: 'planned_variation',
      planned_misclassified: 'potentially_productive_surprise',
      useful: 'potentially_productive_surprise',
      reject: 'potentially_productive_surprise',
      unsupported: 'potentially_productive_surprise',
      anticipated_misclassified: 'potentially_productive_surprise',
      weak_review: 'potentially_productive_surprise',
      defect: 'technical_failure',
      noise: 'random_incoherence',
      unresolved: 'unresolved',
      none: 'expected_realization'
    }[this.scenario];
    return {
      comparisons: [{
        witness_evidence_id: input.witness.observations[0].evidence_id,
        classification,
        description: this.scenario === 'planned_misclassified'
          ? input.plan.planned_ambiguities[0]
          : this.scenario === 'anticipated_misclassified'
            ? input.plan.plan_items.find((item) => item.classification === 'anticipated_risk').description
            : input.witness.observations[0].description,
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
        challenges: this.scenario === 'weak_review' ? [] : this.scenario === 'reject' ? ['The feature is common in prior work.'] : ['All required adversarial challenges were evaluated.'],
        ...(this.scenario === 'weak_review' ? {} : { findings: {
          planned: false,
          trivial: false,
          incoherent: false,
          common_in_prior_work: this.scenario === 'reject',
          technical_defect: false,
          falsely_inferred: false,
          observable_support: true,
          material_interpretive_change: true,
          relates_to_work: true
        } })
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
  const normalized = normalizeCandidatePlan(
    { proposed_accident: 'A doubled edge.' },
    {
      lockedIntention: { anticipated_risk: 'The image may become decorative.' },
      lockEventId: 'evt_lock', candidateSourceEventId: 'evt_candidates', candidateId: 'candidate_a'
    }
  );
  assert.deepEqual(normalized.planned_ambiguities, ['A doubled edge.']);
  assert.equal(normalized.productive_surprise, undefined);
  assert.equal(normalized.legacy_source_field, 'proposed_accident');
  assert.ok(normalized.plan_items.some((item) => item.classification === 'anticipated_risk' && item.source_event_id === 'evt_lock'));
  assert.ok(normalized.plan_items.some((item) => item.classification === 'planned_ambiguity' && item.source_event_id === 'evt_candidates' && item.source_candidate_id === 'candidate_a'));
  const otherCandidate = normalizeCandidatePlan(
    { proposed_accident: 'A doubled edge.' },
    { candidateSourceEventId: 'evt_candidates', candidateId: 'candidate_b' }
  );
  assert.notEqual(
    normalized.plan_items.find((item) => item.classification === 'planned_ambiguity').plan_item_id,
    otherCandidate.plan_items.find((item) => item.classification === 'planned_ambiguity').plan_item_id
  );
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

test('comparator cannot promote a known plan by falsely labeling it unplanned', async () => {
  const { result } = await artifactCycle('planned_misclassified');
  assert.equal(result.postResultEvidence.confirmed_surprises.length, 0);
  assert.equal(result.postResultEvidence.reviewed[0].classification, 'rejected_accident');
});

test('anticipated risk cannot be confirmed as productive surprise', async () => {
  const { result } = await artifactCycle('anticipated_misclassified');
  assert.equal(result.postResultEvidence.confirmed_surprises.length, 0);
  assert.equal(result.postResultEvidence.reviewed[0].classification, 'rejected_accident');
});

test('confirmed status without complete adversarial findings is rejected', async () => {
  await assert.rejects(artifactCycle('weak_review'), /adversarial findings|challenges/i);
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

test('pre-result candidate and critic records contain plans and forecasts, not claimed surprise', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-pre-result-language-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  await runCreativeCycle({
    studio, provider: new DeterministicProvider(), observations, generateImage: false,
    features: { refusal: false }, operationId: 'operation_pre_result_language'
  });
  const events = await studio.ledger.readAll();
  const candidates = events.find((event) => event.type === 'candidates_generated').payload.candidates;
  assert.ok(candidates.every((candidate) => candidate.planned_ambiguity && !('proposed_accident' in candidate)));
  const critiques = events.find((event) => event.type === 'critics_reported').payload.critiques;
  assert.ok(critiques.every((critique) => 'surprise_potential' in critique.scores && !('productive_surprise' in critique.scores)));
  assert.deepEqual((await studio.getState()).active_surprises, []);
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
  for (const field of ['evidence_id', 'cycle_id', 'artifact_id', 'source_role', 'source_type', 'timestamp', 'schema_version', 'locked_intention_event_id', 'confidence', 'classification', 'review_status', 'memory_eligible', 'later_used']) {
    assert.ok(field in result.postResultEvidence.confirmed_surprises[0], `missing provenance field ${field}`);
  }
});

test('creator, witness, comparator, and reviewer can be configured as isolated role providers', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-role-isolation-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const creator = new EvidenceFixtureProvider('useful');
  const witness = new EvidenceFixtureProvider('useful');
  const comparator = new EvidenceFixtureProvider('useful');
  const reviewer = new EvidenceFixtureProvider('useful');
  await runCreativeCycle({
    studio, provider: creator, observations, generateImage: true, features: { refusal: false },
    operationId: 'operation_role_isolation',
    roleProviders: { creator, artifactWitness: witness, deviationComparator: comparator, surpriseReviewer: reviewer }
  });
  assert.equal(creator.witnessCalls.length, 0);
  assert.equal(witness.witnessCalls.length, 1);
  assert.equal(comparator.comparisonCalls.length, 1);
  assert.equal(reviewer.reviewCalls.length, 1);
});

test('missing post-result roles fail before a live-image cycle writes studio state', async () => {
  class UnsupportedProvider extends EvidenceFixtureProvider {
    get supportsPostResultEvidence() { return false; }
  }
  const parent = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-preflight-'));
  const rootDir = path.join(parent, 'studio');
  const studio = new Studio({ rootDir, constitution, experiment });
  await assert.rejects(
    runCreativeCycle({ studio, provider: new UnsupportedProvider('none'), observations, generateImage: true }),
    /post-result role provider/i
  );
  await assert.rejects(access(rootDir), { code: 'ENOENT' });
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

test('crashes before post-result persistence repeat only the unpersisted role call', async (t) => {
  const cases = [
    ['before_artifact_witnessed_persistence', [1, 0, 0], [2, 1, 1]],
    ['before_artifact_deviations_compared_persistence', [1, 1, 0], [1, 2, 1]],
    ['before_surprise_reviewed_persistence', [1, 1, 1], [1, 1, 2]]
  ];
  for (const [boundary, beforeCounts, afterCounts] of cases) {
    await t.test(boundary, async () => {
      const rootDir = await mkdtemp(path.join(os.tmpdir(), `haunted-evidence-before-${boundary}-`));
      const studio = new Studio({ rootDir, constitution, experiment });
      const provider = new EvidenceFixtureProvider('useful');
      const operationId = `operation_${boundary}`;
      await assert.rejects(runCreativeCycle({
        studio, provider, observations, generateImage: true, features: { refusal: false }, operationId, crashAfter: boundary
      }), /injected crash/i);
      assert.deepEqual([provider.witnessCalls.length, provider.comparisonCalls.length, provider.reviewCalls.length], beforeCounts);
      await runCreativeCycle({
        studio: new Studio({ rootDir, constitution, experiment }), provider, observations,
        generateImage: true, features: { refusal: false }, operationId, resume: true
      });
      assert.deepEqual([provider.witnessCalls.length, provider.comparisonCalls.length, provider.reviewCalls.length], afterCounts);
    });
  }
});

test('resume rejects artifact bytes that no longer match the recorded hash', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-artifact-tamper-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const provider = new EvidenceFixtureProvider('useful');
  const operationId = 'operation_artifact_tamper';
  await assert.rejects(runCreativeCycle({
    studio, provider, observations, generateImage: true, features: { refusal: false }, operationId, crashAfter: 'artifact_generated'
  }), /injected crash/i);
  const artifactEvent = (await studio.ledger.readAll()).find((event) => event.type === 'artifact_generated');
  await writeFile(artifactEvent.payload.artifact_path, Buffer.from('tampered artifact bytes'));
  await assert.rejects(runCreativeCycle({
    studio: new Studio({ rootDir, constitution, experiment }), provider, observations,
    generateImage: true, features: { refusal: false }, operationId, resume: true
  }), /artifact hash mismatch/i);
  assert.equal(provider.witnessCalls.length, 0);
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

test('ledger rejects mismatched evidence identity, broken links, and unsupported confirmation', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-linkage-'));
  const ledger = new AppendOnlyLedger(path.join(directory, 'ledger.jsonl'));
  const cycleId = 'cycle_linkage';
  const sequence = [
    ['cycle_started', {}], ['observation_selected', {}],
    ['intention_locked', { intention: { anticipated_risk: 'A known risk.' } }],
    ['candidates_generated', { candidates: [{ id: 'candidate_linkage', planned_ambiguity: 'A known plan.' }] }],
    ['critics_reported', {}], ['curation_decided', { decision: 'accept', round: 0, selected_candidate_id: 'candidate_linkage' }],
    ['artifact_generated', { artifact_id: 'artifact_a', artifact_hash: 'a'.repeat(64), candidate_id: 'candidate_linkage' }]
  ];
  for (const [type, payload] of sequence) await ledger.append({ type, actor: 'test', cycleId, payload });
  const base = {
    evidence_id: 'evidence_witness', cycle_id: cycleId, artifact_id: 'artifact_a',
    source_role: 'artifact_witness', source_type: 'artifact_observation', timestamp: new Date().toISOString(),
    schema_version: 1, code_commit: null, artifact_hash: 'a'.repeat(64),
    locked_intention_event_id: (await ledger.readAll()).find((event) => event.type === 'intention_locked').event_id,
    confidence: 0.9, classification: 'artifact_observation', review_status: 'unreviewed',
    memory_eligible: false, later_used: false, description: 'Visible feature.', observable_support: 'pixels'
  };
  await assert.rejects(ledger.append({
    type: 'artifact_witnessed', actor: 'test', cycleId,
    payload: { artifact_id: 'artifact_b', artifact_hash: 'b'.repeat(64), observations: [base] }
  }), /artifact identity|artifact hash/i);
  const unsupportedWitness = { ...base };
  delete unsupportedWitness.observable_support;
  await assert.rejects(ledger.append({
    type: 'artifact_witnessed', actor: 'test', cycleId,
    payload: { artifact_id: 'artifact_a', artifact_hash: 'a'.repeat(64), observations: [unsupportedWitness] }
  }), /observable support/i);
  await ledger.append({
    type: 'artifact_witnessed', actor: 'test', cycleId,
    payload: { artifact_id: 'artifact_a', artifact_hash: 'a'.repeat(64), observations: [base] }
  });
  await assert.rejects(ledger.append({
    type: 'artifact_deviations_compared', actor: 'test', cycleId,
    payload: { artifact_id: 'artifact_a', artifact_hash: 'a'.repeat(64), witness_evidence_ids: ['missing'], comparisons: [] }
  }), /witness evidence/i);
  const comparison = {
    ...base,
    evidence_id: 'evidence_comparison', source_role: 'deviation_comparator',
    source_type: 'artifact_deviation', classification: 'potentially_productive_surprise',
    witness_evidence_id: base.evidence_id, description: 'Visible unplanned feature.',
    explicitly_planned: false, related_plan_item_ids: [], observable_support: true,
    coherent: true, material_interpretive_change: true, relates_to_work: true
  };
  await ledger.append({
    type: 'artifact_deviations_compared', actor: 'test', cycleId,
    payload: {
      artifact_id: 'artifact_a', artifact_hash: 'a'.repeat(64),
      witness_evidence_ids: [base.evidence_id], plan_items: [], comparisons: [comparison]
    }
  });
  await assert.rejects(ledger.append({
    type: 'surprise_reviewed', actor: 'test', cycleId,
    payload: {
      artifact_id: 'artifact_a', artifact_hash: 'a'.repeat(64),
      no_productive_surprise: false,
      reviewed_evidence: [{
        ...comparison, evidence_id: 'evidence_review', comparison_evidence_id: comparison.evidence_id,
        source_role: 'adversarial_surprise_reviewer', source_type: 'productive_surprise',
        classification: 'productive_surprise', review_status: 'confirmed', memory_eligible: true,
        witness_evidence_ids: [base.evidence_id], challenges: []
      }]
    }
  }), /adversarial|confirmation|criteria|challenges/i);
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
  await abandonCycle({
    studio: restarted,
    operationId: 'operation_incomplete_evidence',
    abandonmentOperationId: 'operation_abandon_incomplete_evidence'
  });
  assert.deepEqual((await restarted.getState()).active_surprises, []);
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

test('pre-PR-2A version-1 lifecycle remains readable, unchanged, and adapts planned claims', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haunted-evidence-v1-'));
  const ledgerPath = path.join(directory, 'ledger.jsonl');
  const types = [
    ['cycle_started', {}], ['observation_selected', {}], ['intention_locked', {}],
    ['candidates_generated', {}], ['critics_reported', {}],
    ['curation_decided', { decision: 'accept', round: 0 }],
    ['audience_predicted', {}], ['memory_consolidated', {
      active_surprises: [{ description: 'Legacy planned claim.', source_candidate_id: 'candidate_legacy' }]
    }], ['cycle_completed', { cycle_id: 'cycle_legacy_v1' }]
  ];
  let previousHash = '0'.repeat(64);
  const lines = types.map(([type, payload], index) => {
    const unsigned = {
      event_id: `evt_legacy_v1_${index + 1}`, schema_version: 1, sequence: index + 1,
      timestamp: `2025-01-01T00:00:${String(index).padStart(2, '0')}.000Z`, type,
      actor: 'legacy-fixture', cycle_id: 'cycle_legacy_v1', payload, previous_hash: previousHash
    };
    const event = { ...unsigned, hash: createHash('sha256').update(canonicalize(unsigned)).digest('hex') };
    previousHash = event.hash;
    return JSON.stringify(event);
  });
  await writeFile(ledgerPath, `${lines.join('\n')}\n`);
  const before = await readFile(ledgerPath, 'utf8');
  const ledger = new AppendOnlyLedger(ledgerPath);
  assert.equal((await ledger.verify()).valid, true);
  assert.equal(await readFile(ledgerPath, 'utf8'), before);
  const state = projectLedger(await ledger.readAll());
  assert.deepEqual(state.active_surprises, []);
  assert.equal(state.planned_hypotheses[0].classification, 'planned_ambiguity');
  assert.equal(state.planned_hypotheses[0].description, 'Legacy planned claim.');
  assert.equal(await readFile(ledgerPath, 'utf8'), before);
});
