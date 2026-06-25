# Fidelity adjudication design

Status: research branch `research/fidelity-adjudication`, first slice. This
document describes how the studio decides whether a finished work honored its
frozen creative commitment, and how that decision stays auditable and honest.

This slice is intentionally standalone: `src/engine/fidelity-adjudication.js`
is a pure domain module with its own append-only record list. It does **not**
yet write to the studio ledger or run inside `runCreativeCycle`. Wiring it into
the live cycle (new ledger event types, lifecycle transitions, and reducer
exposure) is a deliberate later slice; see "Integration path" below.

## Why this exists

Maker self-report cannot be the sole evidence of fidelity. A maker that took a
concealed shortcut has every incentive to report full fidelity. Independent
signals must survive even when the maker reports no violation, and primitive
text matching must never be treated as a final conviction. At the same time,
legitimate artistic transgression is allowed — but it must be distinguishable
from a concealed shortcut, and it can never retroactively rewrite the original
commitment.

## Pipeline

```text
frozen intention
  -> maker self-report
  -> independent signal detection
  -> possible violation
  -> adversarial challenge
  -> { confirmed | rejected | unresolved | undetectable }
```

Each stage appends records; nothing is ever deleted or overwritten.

1. **Frozen intention** (`freezeIntention`). The commitment is deep-frozen and
   hashed (`commitment_hash`). Every later record carries that hash. A record
   that supplies a different hash is rejected, so the commitment cannot be
   rewritten after the fact.
2. **Maker self-report** (`makerSelfReport`). One input among several. It may
   admit deviations, but it cannot delete or outrank independent evidence.
3. **Independent signal detection** (`detectSignals`). Text/description matching
   emits *signals* with `signal_authority: 'non_authoritative_signal'`. A signal
   has no verdict field; the detector cannot convict and cannot adjudicate its
   own finding.
4. **Possible violation** (`raisePossibleViolations`). Breach-type signals are
   raised to allegations with `status: 'alleged'`. A possible violation can
   never confirm itself.
5. **Adversarial challenge** (`adjudicate`). The only stage that produces a
   verdict, and the only place a description-level claim is honestly capped
   below a pixel-level conviction.

## The four preparatory fidelity/provenance fields

Every signal, allegation, and verdict carries the same provenance envelope,
re-created here from first principles:

| Field | Meaning |
|---|---|
| `commitment_hash` | Identity of the frozen commitment the record is about. |
| `evidence_basis` | `artifact_description`, `pixel_inspection`, or `maker_report`. |
| `signal_authority` | `non_authoritative_signal`, `alleged`, `self_report` — how much weight the record may carry. |
| `disclosure_status` | Whether the maker disclosed the deviation (`disclosed`) or it surfaced independently (`undisclosed`). |

## Honesty rules (enforced in code)

- **The maker cannot erase independent evidence.** Records are append-only;
  `appendRecord` only adds. `deriveAdjudication` reads every independent signal
  regardless of any maker report.
- **The detector cannot convict.** `detectSignals` never emits a verdict;
  `raisePossibleViolations` only produces `status: 'alleged'`; only `adjudicate`
  reaches a verdict, and `confirmed` requires a real adversarial challenge.
- **Disagreement is preserved.** When the maker claims fidelity but independent
  breach signals exist, both are retained and surfaced as `disagreements`.
- **Absence is not compliance.** A missing prohibited term is recorded as
  `no_prohibited_signal`; an artifact with no signals derives `status: 'no_signal'`.
  `compliant` is never asserted by this module — only breaches can be confirmed.
- **Artifact-description vs pixel.** A `pixel_level` allegation backed only by
  `artifact_description` evidence cannot be `confirmed`; it must be `unresolved`
  or `undetectable` until real image inspection supplies `pixel_inspection`
  evidence.
- **Transgression cannot rewrite the commitment.** A confirmed deviation is a
  new record that references the frozen `commitment_hash`; it never edits the
  frozen intention. A disclosed deviation is a legitimate transgression
  (`disclosed_transgression_confirmed`); an undisclosed one is a concealed
  shortcut (`concealed_deviation_confirmed`).

## Adversarial reading cases

The detector is built to avoid false convictions on these patterns (one test
each in `test/fidelity-adjudication.test.js`):

- **omission** — a missing required feature becomes a possible omission, not a
  silent pass;
- **negation** — "does not include the red circle" is not read as fulfilled;
- **quotation** — restating the requirement is not evidence of realizing it;
- **synonyms** — a near-synonym is not a violation (it yields `unresolved`-grade
  `synonym_presence`, not a breach);
- **field displacement** — required content in the wrong field is flagged;
- **contradiction** — a maker fidelity claim does not erase an independent
  breach signal;
- **concealed findings** — an undisclosed deviation is marked `undisclosed` and
  can be confirmed, separate from a disclosed transgression.

## Curator canon-threshold correction

`canonEligibility` re-creates the canon gate with the following corrections over
score-only promotion:

- the threshold boundary is **inclusive** (`score >= threshold`), so a work
  scoring exactly at the bar is not wrongly rejected;
- a **confirmed concealed deviation blocks canon** regardless of score;
- an **unresolved/undetectable** fidelity finding downgrades a passing score to
  `needs_fidelity_review` rather than silently passing.

## Integration path (slices)

1. **Done (this branch).** Persist the five record kinds as post-cycle ledger
   events (`fidelity_intention_frozen`, `fidelity_maker_reported`,
   `fidelity_signals_detected`, `fidelity_violation_alleged`,
   `fidelity_adjudicated`) over a completed cycle, with defense-in-depth
   contract validation in `src/core/event-contract.js` and a record<->event
   adapter in `src/engine/fidelity-ledger.js`. The ledger re-checks every
   invariant: a completed cycle is required, the frozen intention must come
   first, the commitment hash cannot be rewritten, a detection signal cannot
   carry a verdict, an allegation must reference real signals, and a pixel-level
   claim cannot be confirmed from artifact-description evidence.
2. **Done.** Orchestrate the pipeline over a completed cycle with role
   isolation, in `src/engine/fidelity-cycle.js` (`runFidelityAdjudication`):
   the commitment is frozen from the cycle's locked intention; the artifact
   description is the BLIND WITNESS output, so detection never reads the maker's
   claims; the maker self-report comes from the creator provider; detection is a
   deterministic function over the independent witness (no provider — it cannot
   be argued with); and adjudication comes from a separate adversarial-reviewer
   provider. The run is resumable and idempotent, and the deterministic provider
   returns an honest `undetectable` verdict because the offline witness makes no
   decodable visual claim. Conceptual-only cycles report fidelity `unavailable`.
   Offline runs legitimately use one provider for every role, so reviewer
   independence is not forbidden but **recorded**: each verdict carries
   `findings.reviewer_independent_of_maker`, and a confirmed verdict from a
   non-isolated reviewer is therefore visibly self-adjudication.
3. Expose `deriveAdjudication` through the projection reducer so confirmed
   concealed deviations gate canon via `canonEligibility`.
4. Feed real pixel inspection (not description) for any `pixel_level` commitment
   before a pixel-level verdict may be confirmed. This is also the structural
   answer to the probe finding: stop treating any description-only affirmation
   as terminal.

## Limits

This slice proves the adjudication *logic and invariants*, not empirical
fidelity. The signal detector is deliberately simple and conservative: it would
rather emit `unresolved`/`synonym_presence` than convict. Description-based
evidence is never silently promoted to a pixel-level claim. None of this is
wired into the live cycle yet, so no existing behavior changes.
