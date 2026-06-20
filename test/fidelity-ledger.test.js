import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEventBeforeAppend } from '../src/core/event-contract.js';
import {
  freezeIntention,
  makerSelfReport,
  detectSignals,
  raisePossibleViolations,
  adjudicate,
  deriveAdjudication
} from '../src/engine/fidelity-adjudication.js';
import {
  fidelityIntentionFrozenEvent,
  fidelityMakerReportedEvent,
  fidelitySignalsDetectedEvent,
  fidelityViolationsAllegedEvent,
  fidelityAdjudicatedEvent,
  fidelityRecordsFromEvents
} from '../src/engine/fidelity-ledger.js';

const CYCLE = 'cycle_x';

const fields = {
  must_include: [{ id: 'inc_circle', term: 'red circle', expected_field: 'foreground' }],
  must_avoid: []
};

function completedCycleLedger() {
  return [{ type: 'cycle_completed', actor: 'orchestrator', cycle_id: CYCLE, payload: {}, schema_version: 1 }];
}

// Validates a spec against the accumulated ledger and, on success, appends the
// stored form (mirroring AppendOnlyLedger.append).
function appendValidated(events, spec) {
  validateEventBeforeAppend({ ...spec, schemaVersion: 1 }, events);
  events.push({ type: spec.type, actor: spec.actor, cycle_id: spec.cycleId, payload: spec.payload, schema_version: 1 });
  return events;
}

function fullSequence({ honored = true, artifact } = {}) {
  const frozen = freezeIntention(fields);
  const report = makerSelfReport(frozen, { honored });
  const signals = detectSignals(frozen, artifact ?? { basis: 'artifact_description', fields: { foreground: 'a quiet grey field' } });
  const possible = raisePossibleViolations(frozen, signals, report);
  return { frozen, report, signals, possible };
}

test('a full fidelity sequence persists and reconstructs over a completed cycle', () => {
  const events = completedCycleLedger();
  const { frozen, report, signals, possible } = fullSequence();
  const verdict = adjudicate(possible[0], { verdict: 'confirmed', challenges: ['No synonym, displacement, or quotation explains the absence.'], confidence: 0.9 });

  appendValidated(events, fidelityIntentionFrozenEvent(frozen, CYCLE));
  appendValidated(events, fidelityMakerReportedEvent(report, CYCLE));
  appendValidated(events, fidelitySignalsDetectedEvent(signals, CYCLE, frozen));
  appendValidated(events, fidelityViolationsAllegedEvent(possible, CYCLE, frozen));
  appendValidated(events, fidelityAdjudicatedEvent(verdict, CYCLE));

  const reconstructed = fidelityRecordsFromEvents(events, CYCLE);
  const derived = deriveAdjudication(reconstructed);
  assert.equal(derived.status, 'concealed_deviation_confirmed');
  assert.equal(derived.confirmed_concealed.length, 1);
  assert.ok(derived.disagreements.length > 0);
});

test('a post-cycle fidelity event requires a completed cycle', () => {
  const events = []; // no cycle_completed
  const { frozen } = fullSequence();
  assert.throws(() => appendValidated(events, fidelityIntentionFrozenEvent(frozen, CYCLE)), /terminal cycle outcome/);
});

test('fidelity events cannot precede the frozen intention', () => {
  const events = completedCycleLedger();
  const { frozen, report } = fullSequence();
  assert.throws(() => appendValidated(events, fidelityMakerReportedEvent(report, CYCLE)), /requires fidelity_intention_frozen/);
  appendValidated(events, fidelityIntentionFrozenEvent(frozen, CYCLE));
});

test('the ledger rejects an event that rewrites the frozen commitment', () => {
  const events = completedCycleLedger();
  const { frozen } = fullSequence();
  appendValidated(events, fidelityIntentionFrozenEvent(frozen, CYCLE));
  const tampered = { type: 'fidelity_maker_reported', actor: 'role:fidelity-adjudicator', cycleId: CYCLE, payload: { commitment_hash: 'commit_tampered', honored: false } };
  assert.throws(() => appendValidated(events, tampered), /original commitment cannot be rewritten/);
});

test('the ledger rejects a detection signal that carries a verdict', () => {
  const events = completedCycleLedger();
  const { frozen, signals } = fullSequence();
  appendValidated(events, fidelityIntentionFrozenEvent(frozen, CYCLE));
  const poisoned = fidelitySignalsDetectedEvent([{ ...signals[0], verdict: 'confirmed' }], CYCLE, frozen);
  assert.throws(() => appendValidated(events, poisoned), /detector does not adjudicate/);
});

test('the ledger rejects an alleged violation referencing an unknown signal', () => {
  const events = completedCycleLedger();
  const { frozen, signals, possible } = fullSequence();
  appendValidated(events, fidelityIntentionFrozenEvent(frozen, CYCLE));
  appendValidated(events, fidelitySignalsDetectedEvent(signals, CYCLE, frozen));
  const orphaned = fidelityViolationsAllegedEvent([{ ...possible[0], basis_signal_ids: ['signal_does_not_exist'] }], CYCLE, frozen);
  assert.throws(() => appendValidated(events, orphaned), /unknown detection signals/);
});

test('the ledger refuses to confirm a pixel-level claim from artifact-description evidence', () => {
  const pixelFields = { must_include: [{ id: 'inc_grad', term: 'gradient', expected_field: 'sky', pixel_level: true }], must_avoid: [] };
  const frozen = freezeIntention(pixelFields);
  const signals = detectSignals(frozen, { basis: 'artifact_description', fields: { sky: 'a flat blue band' } });
  const possible = raisePossibleViolations(frozen, signals, null);

  const events = completedCycleLedger();
  appendValidated(events, fidelityIntentionFrozenEvent(frozen, CYCLE));
  appendValidated(events, fidelitySignalsDetectedEvent(signals, CYCLE, frozen));
  appendValidated(events, fidelityViolationsAllegedEvent(possible, CYCLE, frozen));

  const forced = {
    type: 'fidelity_adjudicated',
    actor: 'role:fidelity-adversarial-reviewer',
    cycleId: CYCLE,
    payload: {
      commitment_hash: frozen.commitment_hash,
      possible_violation_id: possible[0].record_id,
      verdict: 'confirmed',
      challenges: ['claimed pixel inspection without inspecting pixels'],
      confidence: 0.9
    }
  };
  assert.throws(() => appendValidated(events, forced), /pixel-level violation cannot be confirmed/);
});
