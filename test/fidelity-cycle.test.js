import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { runFidelityAdjudication, commitmentFromIntention } from '../src/engine/fidelity-cycle.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { projectLedger } from '../src/core/projection.js';
import { canonicalize } from '../src/core/canonical-json.js';
import { readJson } from '../src/core/fs.js';

// A maker that conceals: it generates an artifact, the blind witness describes
// the required elements as ABSENT, the maker still claims full fidelity, and the
// adversarial reviewer confirms the concealed deviation.
class ConcealmentFixtureProvider extends DeterministicProvider {
  async generateArtifact({ outputPath }) {
    await writeFile(outputPath, Buffer.from('concealed-artifact-bytes'));
    return outputPath;
  }

  async witnessArtifact() {
    return {
      observations: [{
        description: 'A plain, evenly lit grey rectangle. There is no ordinary object rendered with material specificity, no impossible fact treated as normal, and no area of unresolved visual silence.',
        observable_support: 'direct description of the rendered pixels',
        confidence: 0.9
      }]
    };
  }

  async inspectArtifact({ candidate }) {
    return {
      status: 'generated', candidate_id: candidate.id, overall_score: 0.9,
      recommended_action: 'accept_artifact', scores: {}, observations: [], failures: [], strongest_accident: null
    };
  }

  async adjudicateFidelity() {
    return {
      verdict: 'confirmed',
      challenges: ['The witness shows the required elements absent; no synonym, displacement, or quotation explains it, and the maker did not disclose the omission.'],
      findings: { planned: false, observable_support: true },
      confidence: 0.9
    };
  }
}

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));

// A provider that can produce an artifact (the deterministic base cannot), so a
// blind witness exists for fidelity adjudication to read.
class ImageFixtureProvider extends DeterministicProvider {
  constructor() {
    super();
    this.fidelityReportCalls = 0;
    this.fidelityAdjudicateCalls = 0;
  }

  async generateArtifact({ outputPath }) {
    await writeFile(outputPath, Buffer.from('deterministic-artifact-bytes'));
    return outputPath;
  }

  async reportFidelity(input) {
    this.fidelityReportCalls += 1;
    return super.reportFidelity(input);
  }

  async adjudicateFidelity(input) {
    this.fidelityAdjudicateCalls += 1;
    return super.adjudicateFidelity(input);
  }
}

async function completedImageCycle() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-fidelity-cycle-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const provider = new ImageFixtureProvider();
  const result = await runCreativeCycle({
    studio, provider, observations, generateImage: true, features: { refusal: false },
    operationId: `operation_fidelity_${path.basename(rootDir)}`
  });
  return { studio, provider, cycleId: result.cycleId };
}

test('fidelity adjudication over a completed cycle persists events and preserves disagreement', async () => {
  const { studio, provider, cycleId } = await completedImageCycle();
  const result = await runFidelityAdjudication({ studio, cycleId, provider });

  assert.equal(result.status, 'available');
  // One provider fills every role offline, so the reviewer is not independent;
  // this is recorded honestly rather than hidden.
  assert.equal(result.role_isolated, false);
  // The maker asserted full fidelity, but the non-committal witness yields
  // omission allegations the reviewer cannot clear: disagreement is preserved.
  assert.equal(result.adjudication.maker_claims_fidelity, true);
  assert.ok(result.adjudication.disagreements.length > 0);
  assert.ok(result.adjudication.possible_violation_count > 0);
  assert.ok(result.adjudication.verdicts.length > 0);
  assert.ok(result.adjudication.verdicts.every((verdict) => verdict.verdict === 'undetectable'));
  assert.equal(result.adjudication.confirmed_concealed.length, 0);

  const events = await studio.ledger.readAll();
  const types = events.filter((event) => event.cycle_id === cycleId && event.type.startsWith('fidelity_')).map((event) => event.type);
  assert.ok(types.includes('fidelity_intention_frozen'));
  assert.ok(types.includes('fidelity_maker_reported'));
  assert.ok(types.includes('fidelity_signals_detected'));
  assert.ok(types.includes('fidelity_violation_alleged'));
  assert.ok(types.filter((type) => type === 'fidelity_adjudicated').length === result.adjudication.verdicts.length);
  // The ledger remains internally verifiable after the new events.
  assert.equal((await studio.ledger.verify()).valid, true);
  // The detector ran deterministically without any maker access to it.
  assert.equal(provider.fidelityReportCalls, 1);
  assert.ok(provider.fidelityAdjudicateCalls > 0);
});

test('re-running fidelity adjudication is idempotent and adds no duplicate events', async () => {
  const { studio, provider, cycleId } = await completedImageCycle();
  await runFidelityAdjudication({ studio, cycleId, provider });
  const firstCount = (await studio.ledger.readAll()).length;
  const firstReportCalls = provider.fidelityReportCalls;

  const second = await runFidelityAdjudication({ studio, cycleId, provider });
  const secondCount = (await studio.ledger.readAll()).length;
  assert.equal(secondCount, firstCount);
  assert.equal(provider.fidelityReportCalls, firstReportCalls); // no recompute
  assert.equal(second.status, 'available');
});

test('roles are isolated: maker self-report and adversarial review use different providers', async () => {
  const { studio, cycleId } = await completedImageCycle();
  const maker = new ImageFixtureProvider();
  const reviewer = new ImageFixtureProvider();
  const result = await runFidelityAdjudication({ studio, cycleId, provider: maker, roleProviders: { creator: maker, fidelityReviewer: reviewer } });
  assert.equal(maker.fidelityReportCalls, 1);
  assert.equal(maker.fidelityAdjudicateCalls, 0);
  assert.equal(reviewer.fidelityReportCalls, 0);
  assert.ok(reviewer.fidelityAdjudicateCalls > 0);
  // A distinct reviewer is recorded as independent, on the result and on each verdict.
  assert.equal(result.role_isolated, true);
  const adjudicated = (await studio.ledger.readAll()).filter((event) => event.cycle_id === cycleId && event.type === 'fidelity_adjudicated');
  assert.ok(adjudicated.every((event) => event.payload.findings?.reviewer_independent_of_maker === true));
});

test('commitmentFromIntention accepts strings and structured items and drops empties', () => {
  const commitment = commitmentFromIntention({
    must_include: ['a red circle', { term: 'a signature' }, '', { notATerm: true }, 42],
    must_avoid: ['  text  ']
  });
  assert.deepEqual(commitment.must_include.map((item) => item.term), ['a red circle', 'a signature']);
  assert.deepEqual(commitment.must_avoid.map((item) => item.term), ['text']);
});

test('a conceptual-only cycle has no blind witness and reports fidelity unavailable', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-fidelity-conceptual-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const provider = new DeterministicProvider();
  const result = await runCreativeCycle({
    studio, provider, observations, generateImage: false, features: { refusal: false },
    operationId: 'operation_fidelity_conceptual'
  });
  const fidelity = await runFidelityAdjudication({ studio, cycleId: result.cycleId, provider });
  assert.equal(fidelity.status, 'unavailable');
  assert.equal(fidelity.reason, 'no_blind_witness');
});

test('fidelity adjudication refuses a cycle that is not completed', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-fidelity-missing-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  await studio.initialize();
  await assert.rejects(
    runFidelityAdjudication({ studio, cycleId: 'cycle_does_not_exist', provider: new DeterministicProvider() }),
    /requires a completed cycle/
  );
});

async function concealedCycle() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-fidelity-conceal-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const provider = new ConcealmentFixtureProvider();
  const cycle = await runCreativeCycle({
    studio, provider, observations, generateImage: true, features: { refusal: false },
    operationId: `operation_conceal_${path.basename(rootDir)}`
  });
  return { studio, provider, cycleId: cycle.cycleId };
}

test('a confirmed concealed deviation marks the work revoked in canon, never erasing it', async () => {
  const { studio, provider, cycleId } = await concealedCycle();
  const before = await studio.getState();
  assert.equal(before.canon.length, 1, 'the cycle produced a canon work');

  const fidelity = await runFidelityAdjudication({ studio, cycleId, provider });
  assert.ok(fidelity.adjudication.confirmed_concealed.length > 0);
  assert.equal(fidelity.canon_revoked, true);

  const events = await studio.ledger.readAll();
  assert.equal(events.filter((event) => event.type === 'canon_revoked_by_fidelity' && event.cycle_id === cycleId).length, 1);

  const state = await studio.getState();
  // The canon record is NOT removed — it stays, marked revoked, fully auditable.
  assert.equal(state.canon.length, 1);
  const work = state.canon.find((entry) => entry.cycle_id === cycleId);
  assert.equal(work.revoked, true);
  assert.equal(work.revocation.revoked_by, 'fidelity');
  assert.ok(work.revocation.verdict_ids.length > 0);
  // Active canon (excluding revoked) is empty.
  assert.equal(state.canon.filter((entry) => !entry.revoked).length, 0);
  assert.equal((await studio.ledger.verify()).valid, true);
  assert.equal(canonicalize(projectLedger(events)), canonicalize(state));
});

test('a cycle with no confirmed concealment does not revoke canon', async () => {
  const { studio, provider, cycleId } = await completedImageCycle();
  const before = (await studio.getState()).canon.length;
  const fidelity = await runFidelityAdjudication({ studio, cycleId, provider });
  assert.equal(fidelity.canon_revoked, false);
  const state = await studio.getState();
  assert.equal(state.canon.length, before);
  assert.ok(state.canon.every((entry) => !entry.revoked));
});

test('re-running adjudication does not duplicate the revocation event', async () => {
  const { studio, provider, cycleId } = await concealedCycle();
  await runFidelityAdjudication({ studio, cycleId, provider });
  const firstCount = (await studio.ledger.readAll()).length;

  const second = await runFidelityAdjudication({ studio, cycleId, provider });
  const events = await studio.ledger.readAll();
  assert.equal(events.length, firstCount, 'no new events on rerun');
  assert.equal(second.canon_revoked, true);
  assert.equal(events.filter((event) => event.type === 'canon_revoked_by_fidelity').length, 1);
  assert.equal((await studio.getState()).canon.filter((entry) => entry.revoked).length, 1);
});
