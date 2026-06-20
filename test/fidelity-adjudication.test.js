import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freezeIntention,
  makerSelfReport,
  detectSignals,
  raisePossibleViolations,
  adjudicate,
  appendRecord,
  deriveAdjudication,
  canonEligibility
} from '../src/engine/fidelity-adjudication.js';

const baseFields = {
  must_include: [
    { id: 'inc_circle', term: 'red circle', expected_field: 'foreground', synonyms: ['crimson disc'] },
    { id: 'inc_signature', term: 'signature', expected_field: 'corner' }
  ],
  must_avoid: [
    { id: 'avoid_text', term: 'caption text' }
  ]
};

function frozen(fields = baseFields) {
  return freezeIntention(fields, { sourceEventId: 'evt_lock' });
}

function signalFor(signals, itemId) {
  return signals.find((signalRecord) => signalRecord.target_item_id === itemId);
}

// --- Frozen intention immutability -----------------------------------------

test('frozen intention is immutable and its commitment hash is stable', () => {
  const a = frozen();
  const b = freezeIntention(baseFields);
  assert.equal(a.commitment_hash, b.commitment_hash);
  assert.throws(() => { a.fields.must_include = []; }, TypeError);
});

test('a downstream record cannot reference a rewritten commitment', () => {
  const a = frozen();
  assert.throws(
    () => makerSelfReport(a, { honored: true, commitmentHash: 'commit_tampered' }),
    /original commitment cannot be rewritten/
  );
});

// --- Detector cannot convict ------------------------------------------------

test('detector produces signals, never a verdict', () => {
  const f = frozen();
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'an empty wall', corner: 'blank' } });
  for (const signalRecord of signals) {
    assert.equal(signalRecord.kind, 'independent_signal');
    assert.equal(signalRecord.signal_authority, 'non_authoritative_signal');
    assert.equal('verdict' in signalRecord, false);
  }
});

test('a possible violation is always alleged and cannot confirm itself', () => {
  const f = frozen();
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'an empty wall', corner: 'blank' } });
  const possible = raisePossibleViolations(f, signals);
  assert.ok(possible.length > 0);
  for (const violation of possible) {
    assert.equal(violation.status, 'alleged');
    assert.equal(violation.kind, 'possible_violation');
  }
});

// --- Adversarial reading cases ---------------------------------------------

test('omission: a missing required feature becomes a possible omission, not a silent pass', () => {
  const f = frozen();
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'a quiet grey field', corner: 'a small signature' } });
  const circle = signalFor(signals, 'inc_circle');
  assert.equal(circle.signal_type, 'omission');
  const possible = raisePossibleViolations(f, signals);
  assert.ok(possible.some((violation) => violation.target_item_id === 'inc_circle' && violation.alleged_breach === 'omission'));
});

test('negation: "does not include the red circle" is not read as fulfilled', () => {
  const f = frozen();
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'the composition does not include the red circle', corner: 'a small signature' } });
  assert.equal(signalFor(signals, 'inc_circle').signal_type, 'negated_presence');
});

test('quotation: restating the requirement is not evidence of realizing it', () => {
  const f = frozen();
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'the brief required a red circle, yet the surface stays bare', corner: 'a small signature' } });
  assert.equal(signalFor(signals, 'inc_circle').signal_type, 'quoted_requirement');
});

test('synonyms: a near-synonym is not a violation', () => {
  const f = frozen();
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'a crimson disc anchors the frame', corner: 'a small signature' } });
  const circle = signalFor(signals, 'inc_circle');
  assert.equal(circle.signal_type, 'synonym_presence');
  assert.equal(circle.is_breach_signal, false);
  const possible = raisePossibleViolations(f, signals);
  assert.equal(possible.some((violation) => violation.target_item_id === 'inc_circle'), false);
});

test('field displacement: required content in the wrong field is flagged', () => {
  const f = frozen();
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'a red circle dominates', corner: 'empty' } });
  // signature is required in the corner but appears nowhere; circle is in place.
  assert.equal(signalFor(signals, 'inc_circle').signal_type, 'affirmed_presence');
  const displaced = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'a red circle and a signature scrawl', corner: 'empty' } });
  assert.equal(signalFor(displaced, 'inc_signature').signal_type, 'field_displacement');
});

test('contradiction: maker fidelity claim does not erase an independent breach signal', () => {
  const f = frozen();
  const report = makerSelfReport(f, { honored: true, statement: 'I honored every commitment.' });
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'a quiet grey field', corner: 'a small signature' } });
  let ledger = appendRecord([], f);
  ledger = appendRecord(ledger, report);
  for (const signalRecord of signals) ledger = appendRecord(ledger, signalRecord);
  const derived = deriveAdjudication(ledger);
  assert.equal(derived.maker_claims_fidelity, true);
  assert.ok(derived.disagreements.length > 0, 'disagreement between maker and detector must be preserved');
  assert.ok(derived.breach_signal_count > 0, 'maker cannot erase the independent breach signal');
});

test('concealed findings: an undisclosed deviation is marked undisclosed and can be confirmed', () => {
  const f = frozen();
  const report = makerSelfReport(f, { honored: false, disclosedDeviations: [{ target_item_id: 'inc_signature', description: 'I left the signature off intentionally.' }] });
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'a quiet grey field', corner: 'blank' } });
  const possible = raisePossibleViolations(f, signals, report);
  const circle = possible.find((violation) => violation.target_item_id === 'inc_circle');
  const signature = possible.find((violation) => violation.target_item_id === 'inc_signature');
  assert.equal(circle.disclosure_status, 'undisclosed'); // concealed
  assert.equal(signature.disclosure_status, 'disclosed'); // legitimate transgression
});

// --- Verdicts and honesty about evidence basis -----------------------------

test('only an adversarial challenge yields a verdict, and confirmation needs a challenge', () => {
  const f = frozen();
  const [violation] = raisePossibleViolations(f, detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'empty', corner: 'empty' } }), null);
  assert.throws(() => adjudicate(violation, { verdict: 'confirmed', challenges: [], confidence: 0.9 }), /requires at least one adversarial challenge/);
  const verdict = adjudicate(violation, { verdict: 'confirmed', challenges: ['Checked synonyms, displacement, and quotation; none explain the absence.'], confidence: 0.8, findings: { synonym_checked: true } });
  assert.equal(verdict.kind, 'adversarial_challenge');
  assert.equal(verdict.verdict, 'confirmed');
});

test('a pixel-level claim cannot be confirmed from artifact-description evidence', () => {
  const pixelFields = { must_include: [{ id: 'inc_grad', term: 'gradient', expected_field: 'sky', pixel_level: true }] };
  const f = frozen(pixelFields);
  const [violation] = raisePossibleViolations(f, detectSignals(f, { basis: 'artifact_description', fields: { sky: 'a flat blue band' } }), null);
  assert.equal(violation.pixel_level, true);
  assert.equal(violation.evidence_basis, 'artifact_description');
  assert.throws(() => adjudicate(violation, { verdict: 'confirmed', challenges: ['x'], confidence: 0.9 }), /pixel-level violation cannot be confirmed/);
  const honest = adjudicate(violation, { verdict: 'undetectable', confidence: 0.4 });
  assert.equal(honest.verdict, 'undetectable');
});

test('a pixel-level claim can be confirmed once the image is actually inspected', () => {
  const pixelFields = { must_include: [{ id: 'inc_grad', term: 'gradient', expected_field: 'sky', pixel_level: true }] };
  const f = frozen(pixelFields);
  const [violation] = raisePossibleViolations(f, detectSignals(f, { basis: 'pixel_inspection', fields: { sky: 'a flat blue band, no gradient present' } }), null);
  assert.equal(violation.evidence_basis, 'pixel_inspection');
  const verdict = adjudicate(violation, { verdict: 'confirmed', challenges: ['Inspected pixels: the sky is a single flat value.'], confidence: 0.95 });
  assert.equal(verdict.verdict, 'confirmed');
});

// --- Derived status honesty -------------------------------------------------

test('absence of any signal is reported as no_signal, never as compliant', () => {
  const f = frozen({ must_include: [], must_avoid: [] });
  const derived = deriveAdjudication(appendRecord([], f));
  assert.equal(derived.status, 'no_signal');
  assert.equal(derived.compliant, false);
});

test('a confirmed concealed deviation surfaces distinctly from a disclosed transgression', () => {
  const f = frozen();
  const signals = detectSignals(f, { basis: 'artifact_description', fields: { foreground: 'a quiet grey field', corner: 'a small signature' } });
  const concealedReport = makerSelfReport(f, { honored: true });
  const possible = raisePossibleViolations(f, signals, concealedReport);
  const circle = possible.find((violation) => violation.target_item_id === 'inc_circle');
  const verdict = adjudicate(circle, { verdict: 'confirmed', challenges: ['No synonym, displacement, or quotation explains the absence.'], confidence: 0.9 });
  let ledger = [f, concealedReport, ...signals, ...possible, verdict];
  const derived = deriveAdjudication(ledger);
  assert.equal(derived.status, 'concealed_deviation_confirmed');
  assert.equal(derived.confirmed_concealed.length, 1);
  assert.equal(derived.confirmed_disclosed.length, 0);
});

// --- Curator canon-threshold correction ------------------------------------

test('canon eligibility uses an inclusive threshold boundary', () => {
  assert.equal(canonEligibility({ auditScore: 0.8, threshold: 0.8 }).eligible, true);
  assert.equal(canonEligibility({ auditScore: 0.79, threshold: 0.8 }).eligible, false);
});

test('a confirmed concealed deviation blocks canon regardless of score', () => {
  const result = canonEligibility({ auditScore: 0.99, threshold: 0.8, fidelityVerdicts: [{ verdict: 'confirmed', disclosure_status: 'undisclosed' }] });
  assert.equal(result.eligible, false);
  assert.equal(result.status, 'concept_blocked_concealed_deviation');
});

test('an unresolved fidelity finding downgrades a passing score to needs-review', () => {
  const result = canonEligibility({ auditScore: 0.9, threshold: 0.8, fidelityVerdicts: [{ verdict: 'unresolved', disclosure_status: 'undisclosed' }] });
  assert.equal(result.eligible, false);
  assert.equal(result.status, 'needs_fidelity_review');
});
