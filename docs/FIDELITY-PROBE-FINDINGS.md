# Fidelity detector probe: findings

Status: research finding from `scripts/fidelity-probe.js`. This documents
something that was *not* known before the probe: where the conservative
fidelity detector's honesty guarantees actually break, and why one failure
class matters far more than the other.

## What was probed

The detector is built on a deliberate principle — "emit a non-authoritative
signal, never convict." We had example-based tests for omission, negation,
quotation, synonyms, and displacement, but no map of behavior under *adversarial
language the detector was not designed against*. The probe runs a labeled
corpus (features known to be honored or violated) through `detectSignals` and
classifies every result.

## The finding

The probe surfaced two failure classes, and they are **not symmetric in
danger**:

| Class | Example | Detector output | Contained? |
|---|---|---|---|
| **False conviction** | "not without a red circle" (double negation); "as required, a red circle is clearly present" (attribution) | a breach signal on an *honored* feature | **Yes** — becomes a `possible_violation` the adversarial challenge can reject. |
| **Missed concealment** | "a red circle? hardly — only flat grey remains"; "where a red circle should be, there is nothing" | `affirmed_presence` (non-breach) on a *violated* feature | **No** — nothing escalates; the pipeline closes before review. |

Initial run: 14 cases, 3 false convictions, 2 missed concealments.

### Why the asymmetry is the point

The system's entire safety argument is "the detector can warn but cannot
convict." That protects against false **positives**: a wrong breach signal is
just an allegation, and the adversarial reviewer is the backstop.

But the unguarded channel is false **affirmation**. When affirmative-looking
language produces a clean substring match, the detector records
`affirmed_presence` and the pipeline terminates with no allegation and no
review. The silence is indistinguishable from real fidelity. This is the
project's own warning — *absence of a signal is not proof of compliance* — in
its sharpest form: the detector does not merely stay silent, it actively
**vouches** for a feature that is not there.

## The correction (architecture-aligned, not an NLP arms race)

The fix is not to make negation/attribution detection cleverer — that is an
endless arms race, and false convictions are already contained. The fix is to
remove the *terminal* affirmation: a clean match is no longer treated as proof.

When a required term matches but its surrounding frame carries doubt
(rhetorical, counterfactual, or interrogative markers such as `?`, "hardly",
"should be", "nothing", "where a"), the detector now emits a challengeable
`ambiguous_presence` breach signal instead of `affirmed_presence`. Escalation is
always the safe direction: an honestly-present feature survives the adversarial
challenge, while a concealed absence is forced into review rather than slipping
through.

After the correction the probe reports **0 missed concealments**; the 3 false
convictions remain by design, contained downstream.

## What we still do not know (open questions)

- The doubt-marker list is heuristic; an adversary could phrase concealment
  without any listed marker. The deeper structural fix is to stop treating
  *any* description-only affirmation as terminal and require independent
  corroboration (e.g. pixel inspection) before a required feature is considered
  satisfied — see the `pixel_level` gating already in the design.
- False convictions cost adversarial-review effort. We do not yet know the rate
  at which honest makers trigger them on natural language, only that they cannot
  produce a wrong `confirmed` verdict.
- The probe uses a single commitment item. Interaction effects across many
  required/prohibited items are unmeasured.

## Reproduce

```
node scripts/fidelity-probe.js
```

Regression coverage for the corrected behavior lives in
`test/fidelity-adjudication.test.js` ("rhetorical denial…", "counterfactual
framing…", "an unambiguous honored feature still affirms…").
