// Fidelity detector probe.
//
// The detector is deliberately conservative ("emit a signal, never convict").
// But we do not actually know WHERE its honesty breaks under adversarial
// language. This probe runs a labeled corpus through detectSignals and reports
// two failure classes:
//
//   * false conviction  — a HONORED feature produces a breach signal
//                         (contained downstream by the adversarial challenge);
//   * missed concealment — a VIOLATED feature produces a NON-breach signal,
//                         so nothing escalates and the silence looks honest.
//
// Run: node scripts/fidelity-probe.js

import { freezeIntention, detectSignals } from '../src/engine/fidelity-adjudication.js';

const fields = {
  must_include: [{ id: 'inc_circle', term: 'red circle', expected_field: 'foreground', synonyms: ['crimson disc'] }],
  must_avoid: [{ id: 'avoid_caption', term: 'caption text' }]
};
const frozen = freezeIntention(fields);

// Each case: the text of the foreground field, ground truth for the required
// "red circle", and whether the prohibited "caption text" is actually present.
const corpus = [
  // --- plain honored ---
  { text: 'a red circle sits in the center', circle: 'honored' },
  { text: 'a bold red circle dominates the foreground', circle: 'honored' },
  { text: 'a crimson disc anchors the frame', circle: 'honored', note: 'synonym' },

  // --- plain violated ---
  { text: 'an empty grey field', circle: 'violated' },
  { text: 'the composition omits the red circle', circle: 'violated' },
  { text: 'no red circle appears anywhere', circle: 'violated' },
  { text: 'the foreground lacks a red circle', circle: 'violated' },

  // --- adversarial: should the detector be fooled? ---
  { text: 'not without a red circle at its heart', circle: 'honored', note: 'double negation = present' },
  { text: 'a red circle is not absent here', circle: 'honored', note: 'negation of absence' },
  { text: 'as required, a red circle is clearly present', circle: 'honored', note: 'attribution + assertion' },
  { text: 'the brief asked for a red circle and we delivered exactly that', circle: 'honored', note: 'attribution + delivery' },
  { text: 'a red circle? hardly — only flat grey remains', circle: 'violated', note: 'rhetorical denial' },
  { text: 'where a red circle should be, there is nothing', circle: 'violated', note: 'counterfactual' },
  { text: 'the brief did not call for a red circle, so the surface stays bare', circle: 'violated', note: 'attribution of a negation' }
];

const BREACH = new Set(['omission', 'negated_presence', 'quoted_requirement', 'field_displacement', 'ambiguous_presence']);

let falseConviction = 0;
let missed = 0;
let correct = 0;
const findings = [];

for (const item of corpus) {
  const signals = detectSignals(frozen, { basis: 'artifact_description', fields: { foreground: item.text } });
  const signal = signals.find((entry) => entry.target_item_id === 'inc_circle');
  const isBreach = BREACH.has(signal.signal_type);
  let verdict;
  if (item.circle === 'honored' && isBreach) { verdict = 'FALSE CONVICTION'; falseConviction += 1; }
  else if (item.circle === 'violated' && !isBreach) { verdict = 'MISSED CONCEALMENT'; missed += 1; }
  else { verdict = 'ok'; correct += 1; }
  if (verdict !== 'ok') findings.push({ verdict, truth: item.circle, signal: signal.signal_type, note: item.note ?? '', text: item.text });
}

console.log(`cases: ${corpus.length}  correct: ${correct}  false_convictions: ${falseConviction}  missed_concealment: ${missed}\n`);
for (const finding of findings) {
  console.log(`[${finding.verdict}] truth=${finding.truth} signal=${finding.signal} (${finding.note})`);
  console.log(`   "${finding.text}"`);
}
