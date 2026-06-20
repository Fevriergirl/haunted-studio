# Post-result evidence and productive-surprise design

Status: implementation contract for PR 2A. This design corrects when and how
artifact-derived surprise may be recorded. It does not change motif counting,
human-review memory, canon classification, scoring weights, ablations, provider
selection, or live-provider behavior.

## Core distinction

A plan is not a result. Before an artifact exists, the creator may state an
intention, expected effects, risks, ambiguity, failure modes, and deliberate
variation. Those statements are hypotheses. They cannot establish artifact
deviation, discovered meaning, accidental success, audience interpretation, or
productive surprise.

Post-result evidence becomes available only after an artifact has been recorded
with a stable artifact identifier and content hash. A blind witness first
describes observable features. A comparator then relates those observations to
the locked intention and plan. An adversarial reviewer challenges any proposed
surprise. The absence of productive surprise is valid and expected in many
cycles.

Conceptual-only cycles record `post_result_evidence_unavailable`. They do not
fabricate artifact observations or artifact-derived surprise.

## Evidence vocabulary

| Type | Creation time and role | Required evidence | Intent/source | Memory and future-work eligibility |
|---|---|---|---|---|
| `anticipated_risk` | Before generation, creator | Locked intention or candidate plan | Intentional hypothesis | May inform generation and audit, but never enters memory as discovered surprise. |
| `planned_ambiguity` | Before generation, creator | Explicit plan linked to locked intention | Intentional hypothesis | May guide the artifact. If realized, it remains planned rather than surprising. |
| `planned_variation` | Before generation, creator/editor | Explicit variation linked to candidate or revision | Intentional hypothesis | May guide the artifact. It cannot be promoted merely because it appears. |
| `artifact_observation` | After artifact record, blind witness | Artifact ID, artifact hash, factual observation | Observed | May support later comparison; not independently a memory claim. |
| `artifact_deviation` | After witness, comparator | Linked witness observation plus locked plan | Inferred from observed evidence | May become a reviewed evidence candidate; not automatically memory-eligible. |
| `generation_error` | After witness/comparison, comparator | Observable technical failure | Observed/inferred defect | Ineligible for productive-surprise memory unless separately reclassified with new evidence; this PR treats it as ineligible. |
| `productive_surprise` | After adversarial review | Supported deviation, comparison, challenge result, and all confirmation criteria | Observed, inferred, independently reviewed | Eligible for memory and future work only when review status is `confirmed`. Later causal use is reserved for PR 2B. |
| `unresolved_deviation` | After comparison or review | Observable support exists but classification/confidence is insufficient | Observed/inferred uncertainty | Preserved as evidence, ineligible for surprise memory until a later typed review. |
| `rejected_accident` | After adversarial review | Proposed surprise plus rejection reason | Reviewed negative finding | Preserved for provenance; ineligible for productive-surprise memory or future-work claims. |

Legacy `proposed_accident` values are adapted as `planned_ambiguity`.
Historical untyped `memory_consolidated.active_surprises` claims are excluded
from active surprise and exposed as non-memory-eligible `planned_hypotheses`.
Their original bytes and ledger hashes remain unchanged. They are never treated
as discovered or confirmed surprise.

## Provenance envelope

Each post-result evidence item records:

- `evidence_id`, `cycle_id`, and blind `artifact_id`;
- `source_role` and `source_type`;
- `timestamp` and `schema_version`;
- `code_commit` when supplied by the runtime;
- `artifact_hash`;
- `locked_intention_event_id`;
- `witness_evidence_ids` and `comparison_evidence_id` where applicable;
- normalized confidence from 0 to 1;
- classification and review status;
- `memory_eligible` and `later_used` flags.

The envelope stores no credentials, API keys, private reviewer identity, or raw
private human data. Evidence IDs and artifact IDs are opaque. Artifact paths may
be used operationally but are not identity.

## Role isolation

The orchestration accepts logically separate role providers for:

- creator;
- artifact witness;
- deviation comparator;
- adversarial surprise reviewer.

Offline operation may assign one deterministic provider object to all roles,
but each call has an isolated input contract.

The witness receives only:

- blind artifact ID;
- artifact representation or local path needed for inspection;
- artifact hash and minimal technical metadata.

The witness input excludes the locked intention, creative rationale, candidate
plan, planned ambiguity, legacy proposed accident, criticism, curation,
audience prediction, and memory. Tests inspect the actual witness-call input.

The comparator receives the locked intention, normalized pre-result plan,
artifact metadata, and blind witness output. It may classify each supported
difference as `expected_realization`, `planned_variation`, `neutral_deviation`,
`technical_failure`, `random_incoherence`, `potentially_productive_surprise`,
or `unresolved`.

The adversarial reviewer receives a provisional comparison, its linked
evidence, and committed prior-work summaries including reviewed post-result
evidence where available. It must test whether the feature was planned,
trivial, incoherent, already common in prior work, falsely inferred, or merely
technical failure. It returns `confirmed`, `rejected`, or `unresolved` with
structured findings, challenges, and confidence.

## Surprise confirmation

A comparator may propose `potentially_productive_surprise`, but the persisted
confirmed classification is `productive_surprise` only when all are true:

1. The feature was not explicitly planned.
2. A linked blind witness observation provides observable support.
3. It is coherent enough not to be corruption, noise, or technical failure.
4. It materially changes or deepens interpretation.
5. It relates to the work or an unresolved tension.
6. Provenance and confidence are complete.
7. Adversarial review confirms it after considering the rejection challenges.

Failure of any criterion yields `rejected_accident` or
`unresolved_deviation`, not productive surprise. An empty proposal list yields
a normal `no_productive_surprise` review outcome.

## Lifecycle

For artifact-generating accepted cycles, the narrow version-1 lifecycle is:

```text
artifact_generated
  -> artifact_witnessed
  -> artifact_deviations_compared
  -> surprise_reviewed
  -> artifact_audited
  -> [artifact_audit_not_passed]
  -> [audience_predicted]
  -> memory_consolidated
  -> cycle_completed
```

For a conceptual-only accepted cycle:

```text
curation_decided/curation_overridden_by_condition
  -> post_result_evidence_unavailable
  -> [audience_predicted]
  -> memory_consolidated
  -> cycle_completed
```

Rejected cycles may proceed directly to memory as before because no artifact or
artifact surprise is claimed. Invalid evidence ordering is rejected before
persistence. Crash injection is supported after witness, comparison, and review
events; resume reuses each persisted result and does not repeat provider calls.

## Projection and commitment

Evidence from incomplete or failed cycles remains ledger provenance but is not
committed to projected memory. On `cycle_completed`, the authoritative reducer
may expose only confirmed, memory-eligible evidence as active surprise. This PR
removes the previous pre-result promotion from deterministic memory output.
Live projection and replay continue to use the same reducer.

## Compatibility

- Version-0 and existing version-1 ledger lines remain byte-for-byte unchanged.
- Read adapters interpret candidate `proposed_accident` as planned ambiguity.
- Historical `memory_consolidated.active_surprises` remain readable historical
  payloads and are not rewritten. The projection adapter treats untyped entries
  as planned hypotheses rather than active surprise.
- New cycles write the new evidence events and do not use `proposed_accident` as
  proof of surprise.
- New event order validation applies to newly written version-1 events. Stored
  older version-1 histories that predate these event types remain valid through
  an explicit legacy lifecycle compatibility path.

## Limits

This protocol strengthens causal auditability but does not prove artistic
quality, novelty, or development. The deterministic provider supplies fixtures,
not empirical evidence. Artifact inspection quality still depends on the
provider and artifact representation. PR 2B will address how typed evidence
enters autobiographical memory and how later causal use is recorded.

The existing experiment weight key `productive_surprise` remains unchanged for
configuration compatibility in this PR. It now weights the explicitly
pre-result `surprise_potential` forecast. Sensitivity and weight redesign remain
reserved for the experimental-integrity phase.
