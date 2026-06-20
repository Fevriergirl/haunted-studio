# Research-Logic and State-Integrity Audit

- Audit date: 2026-06-20
- Audited revision: `776b222` (`main`)
- Audit branch: `audit/logic-integrity`
Scope: audit and migration planning only; no production behavior was changed.

## Research question

> Can a persistent artificial creative system develop a recognizable trajectory when previous work, unresolved tensions, criticism, audience interpretation, and irreversible history alter what it produces next?

This is a legitimate experimental question, but the current implementation cannot yet provide strong evidence for or against it. The repository implements a useful role-separated orchestration prototype and a tamper-evident append-only event log. It does not yet establish that later outputs were causally altered by post-result surprise, artifact findings, or human interpretation. Several implementation shortcuts can manufacture the appearance of continuity without establishing that relationship.

This audit makes no claim about consciousness, subjective experience, inspiration, artistic merit, or demonstrated artistic development.

## Method and scope

The audit covered the complete tracked tree, all source and test files, configuration, workflows, documentation, provider interfaces, cycle orchestration, ledger projection, experiment runner, manifests, and provenance fields. It also exercised every existing offline validation command. No live provider call was made.

The following areas received specific review:

- the complete creative-cycle sequence;
- deterministic and live-provider interfaces;
- role input and output validation;
- intention locking;
- candidate and artifact status;
- surprise creation and carryover;
- motif formation;
- memory consolidation;
- simulated audience predictions and consented human reviews;
- canon semantics;
- ledger append, verification, projection, and rebuilding;
- failure, retry, and fork behavior;
- experiment conditions and ablations;
- scoring weights and thresholds;
- manifests, provenance, and all related tests.

## Executive assessment

The strongest implemented property is ledger hash-chain integrity: ordinary tampering is detected, and the tests exercise that behavior. Intention is also persisted before candidate generation in the normal cycle path. Human reviews use explicit consent and separate event types from simulated audience predictions.

The central research logic is not yet sound enough for causal interpretation. In particular:

1. A candidate's predeclared `proposed_accident` can become a preserved “productive surprise” without a generated artifact or other post-result evidence.
2. Observation tags are counted as motifs, allowing input metadata to create the appearance of recurring output motifs.
3. Artifact audits and human reviews are not routed into autobiographical memory as typed evidence, and deterministic later decisions ignore them.
4. A cycle may acquire both `cycle_completed` and `cycle_failed` events.
5. Projected state does not identify its ledger head, so stale state is not reliably detected.
6. Cycle retries are not idempotent.
7. Two of the five basic ablations change more than one feature; some ablations do not affect the deterministic decision path they are used to evaluate.
8. Most provider outputs and all event payloads lack runtime schema validation.

Passing tests therefore demonstrate mechanics and selected invariants, not a recognizable trajectory, improvement, independent judgment, or causal use of prior evidence.

## Implemented cycle sequence

The normal path in `src/engine/creative-cycle.js` is:

1. Initialize from projected state without comparing that state to the ledger head.
2. Append `cycle_started`.
3. Select and persist an observation.
4. Form necessity and intention.
5. Hash and append `intention_locked` before candidate generation.
6. Generate candidates and append `candidates_generated`.
7. Obtain critic reports and append `critics_reported`.
8. Curate, optionally revise once, and append curation/revision events.
9. Optionally generate an artifact and audit it.
10. Optionally generate a simulated audience prediction.
11. Consolidate memory without passing artifact-audit or audience-prediction evidence.
12. Append `memory_consolidated`.
13. Add the selected concept to a single `canon` collection, regardless of artifact status.
14. Write a manifest.
15. Append `cycle_completed`.
16. Save projected state.
17. Verify the ledger.

On any caught error, the cycle appends `cycle_failed`. Because completion is appended before state saving and final verification, a failure at steps 16 or 17 can leave both terminal events. Earlier successful events and files remain present after failure, and the rebuild reducer applies `memory_consolidated` events even when their cycle never completed.

## Answers to the high-priority questions

| # | Question | Answer | Findings |
|---|---|---|---|
| 1 | Is productive surprise discovered after an artifact exists? | No. It can be proposed with a candidate and preserved during memory consolidation before any artifact exists. | F-01 |
| 2 | Can observation tags create apparent recurring motifs? | Yes. Every observation tag is incremented as a motif, then fed back into attention and criticism. | F-02 |
| 3 | Do artifact audits and human reviews alter later memory and decisions? | Not through an explicit evidence path. Artifact audits are omitted from memory consolidation; human reviews update projected state, but deterministic roles ignore them. Live roles could use the undifferentiated state implicitly, which is not auditable causal use. | F-03, F-15 |
| 4 | Can simulated audience output be confused with human evidence? | Event and report paths currently distinguish them, but neither has an enforced event schema and rebuilt human-review state loses fields. The separation is structural but not yet an enforced invariant. | F-04, F-12 |
| 5 | Are concept acceptance and artifact canonization fully separate? | No. Status values distinguish outcomes, but all selected concepts enter one collection named `canon`. | F-05 |
| 6 | Can one cycle become both completed and failed? | Yes, if saving projected state or final verification fails after `cycle_completed` is appended. | F-06 |
| 7 | Can projected state become stale without automatic detection? | Yes. State stores no ledger-head identity, and `doctor` primarily compares completed-cycle counts. | F-07 |
| 8 | Are retries idempotent? | No. Reusing a cycle ID can duplicate events, canon entries, motif counts, and memory effects. | F-08 |
| 9 | Does each ablation modify exactly one intended feature? | No. `no_memory` changes memory and surprise carryover; `forced_acceptance` changes refusal and revision. | F-10 |
| 10 | Are role judgments sufficiently independent? | No. A single provider/model configuration supplies every role, candidate order is fixed, and deterministic curation mechanically consumes same-provider critic scores. | F-11 |
| 11 | Are all outputs and events schema-validated? | No. Validation is partial; revised candidates, audience predictions, memory, artifact audits, and all event payloads lack complete runtime schemas. | F-12 |
| 12 | Are configuration fields enforced? | No. Some are inert, some are treated only as prompt context by the live provider, and numeric ranges are not validated. | F-13 |
| 13 | Can scoring manufacture apparent improvement? | Yes. Input-derived motifs, selection thresholds, survivorship, coupled judge/curator logic, and unstable candidate identifiers can create favorable trends without an independent longitudinal outcome. | F-02, F-14 |
| 14 | Is every causal link to earlier work auditable? | No. Preserved surprises and motifs lack typed evidence and later-use records; manifests omit several identifiers and hashes needed for traceability. | F-15, F-16 |

## Required invariant assessment

| Required invariant | Status | Basis |
|---|---|---|
| No surprise can be recorded before post-result evidence exists. | **Fails** | Candidate `proposed_accident` is promoted during memory consolidation. |
| A planned ambiguity is not a productive surprise. | **Fails** | The implementation does not type or separate these concepts. |
| A simulated audience prediction can never become human-review evidence. | **Partially holds; not enforced** | Separate events and report counters exist, but event schemas and transition rules do not. |
| No concept enters artifact canon without an artifact that passed audit. | **Fails as represented** | A single `canon` contains conceptual and failed-artifact statuses. |
| A cycle cannot be both completed and failed. | **Fails** | Terminal-event ordering permits both. |
| Replaying the same cycle ID cannot duplicate state effects. | **Fails** | No uniqueness or idempotency key is enforced. |
| Rebuilding from a valid ledger is deterministic. | **Partially implemented; unproven** | Replay is ordered, but no equality/property test exists and rebuilt state differs from live state for human reviews and incomplete memory events. |
| A fork cannot mutate its parent history. | **Holds in ordinary single-writer use; concurrency unproven** | The fork appends only to the copy, but copying is not synchronized with parent writes. |
| State records which ledger head it projects. | **Fails** | No projected-head sequence/hash is stored. |
| Invalid role responses are rejected before persistence. | **Fails** | Several outputs have no validator or bypass an existing validator. |
| Every basic ablation changes exactly one declared feature. | **Fails** | Two conditions are compound. |
| Every autobiographical claim identifies evidence and later causal use. | **Fails** | Evidence type, source-event identity, and later-use disposition are absent. |

## Classified findings

### F-01 — Predeclared accidents are promoted as discovered surprise

- **Classification:** experimental confound
- **Severity:** critical

Candidate generation requires a `proposed_accident`. Critic scoring treats that declaration as productive-surprise material, and deterministic memory consolidation preserves it when the concept is accepted. This can happen with no artifact generation and no external result. The live-provider prompts follow the same pre-result representation.

This conflates anticipated risk, planned ambiguity, proposed accident, random error, observed deviation, and productive surprise. It directly violates the first two required invariants and makes apparent surprise carryover unsuitable as evidence.

### F-02 — Input tags manufacture motif recurrence

- **Classification:** experimental confound
- **Severity:** critical

Deterministic memory consolidation increments `motifs[tag]` for every observation tag. Later attention and criticism treat those keys as historical motif recurrence. No artifact observation, human finding, or model-identified feature is required.

The system can therefore convert repeated input labeling into apparent recurring creative motifs, then reward candidates for matching those same labels. Motif categories must be separated into input tags, intended motifs, artifact-observed motifs, and human audience findings before motif continuity can support the research question.

### F-03 — Post-result evidence does not enter memory through a typed path

- **Classification:** implementation defect
- **Severity:** high

The cycle calls memory consolidation without the artifact audit or simulated audience prediction. Consented human reviews update `state.audience_findings`, but no typed memory event incorporates them. The deterministic provider does not use artifact-audit findings or human-review findings in later decisions.

The live provider receives broad projected state and might respond to those fields, but that is implicit prompt exposure rather than an auditable causal relationship. A later output cannot be attributed to a particular audit or review.

### F-04 — Human and simulated audience data are separated but not invariant-safe

- **Classification:** state-integrity risk
- **Severity:** high

The implementation uses distinct `audience_predicted` and `human_review_recorded` events, requires consent for human reviews, and counts only the latter as reviews in reports. Those are sound separations.

However, event payloads have no enforced schemas. Rebuilding a human review drops fields retained in live projected state, including predicted first notice and likely misreading. Replay therefore does not recreate the same evidence representation. Strong evidence typing and projection parity are needed before the separation is an invariant rather than a convention.

### F-05 — One collection conflates concept archive and artifact canon

- **Classification:** documentation mismatch
- **Severity:** high

Selected concepts enter `state.canon` whether they are `conceptual_only`, `artifact_audit_passed`, `artifact_audit_rejected`, or `artifact_needs_revision`. Status is explicit and tested, but naming the combined collection “canon” implies a stronger result than its contents support.

Concept archive, audited artifact canon, failed artifacts, unfinished works, and refusals need separate representations or an equally explicit typed work registry. Reports and documentation should not call conceptual acceptance artifact canonization.

### F-06 — A cycle can have two terminal states

- **Classification:** state-integrity risk
- **Severity:** critical

`cycle_completed` is appended before projected state is saved and before the final ledger verification. If either later step throws, the catch path appends `cycle_failed`. There is no transition validator preventing both events.

This also leaves an ambiguous recovery question: the ledger says completed, projected state may be stale, and the same cycle also says failed. A legal state machine and exactly-one-terminal rule are required.

### F-07 — Projected state can be stale without reliable detection

- **Classification:** state-integrity risk
- **Severity:** critical

Projected state records no ledger-head sequence, event ID, or hash. Startup reads it without validating its correspondence to the ledger. The doctor check compares cycle counts, which cannot detect stale canon, motif, review, correction, or fork projections when the completed-cycle count happens to match.

Startup must compare a stored projected head to the verified ledger head and either rebuild deterministically or require explicit recovery. Silent continuation from stale state risks compounding an incorrect projection.

### F-08 — Cycle and evidence retries are not idempotent

- **Classification:** state-integrity risk
- **Severity:** critical

The ledger accepts repeated cycle IDs, and the engine has no operation ID, replay guard, or resume protocol. Repeating a cycle ID can duplicate canon, motifs, memory, and terminal events. Human-review and memory-correction retries similarly create additional records rather than recognizing the same operation.

Safe retry requires stable operation identity, transition-aware resume semantics, and reducer-level duplicate protection. Random default cycle IDs reduce accidental collisions but do not provide idempotency.

### F-09 — Rebuild does not reproduce the committed live projection

- **Classification:** implementation defect
- **Severity:** critical

The reducer applies every `memory_consolidated` event even if its cycle later fails or never completes. It also reconstructs human audience findings with fewer fields than the live update path. There is no deep equality test comparing live state with a rebuild from the same ledger.

Rebuild must derive state only from legally committed transitions and use one reducer for both live updates and replay. Until then, “rebuild succeeded” means a projection was produced, not that the original valid state was reproduced.

### F-10 — Basic ablations are compound and sometimes behaviorally inert

- **Classification:** experimental confound
- **Severity:** critical

`no_memory` disables autobiographical memory and surprise carryover. `forced_acceptance` disables refusal and revision. These conditions cannot isolate one causal feature. No-refusal and no-revision are not separately measured, and no-memory versus no-surprise is neither documented as nested nor implemented as a factorial design.

Additional interpretation problems exist:

- no-memory blanks role context but still computes and stores memory metrics, so it is closer to a retrieval ablation than removal of memory formation;
- the deterministic provider does not use preserved surprises, so no-surprise carryover may not alter its decisions;
- audience prediction is not fed into later memory, and smoke experiments include no human reviews, so no-audience-model may change telemetry without changing the later creative path.

The current smoke run produced acceptance rate `1` and score entropy `0` in every condition. That confirms execution, not discriminative experimental behavior.

### F-11 — Role judgments are not sufficiently independent for evaluation claims

- **Classification:** experimental confound
- **Severity:** high

Creator, witness, critics, curator, simulated audience, and memory are methods on one provider instance. The live provider uses one configured model and shared provider settings; the deterministic provider couples critic scoring and curatorial choice. Candidate IDs and order are visible and stable within a cycle, with no blinding or randomized ordering.

Role separation is useful orchestration structure, but it is not independent judgment. Experiments need optional per-role provider/model configuration and blinded randomized candidate presentation. Any remaining shared-model dependence must be reported.

### F-12 — Runtime validation is incomplete

- **Classification:** missing validation
- **Severity:** critical

Initial necessity, intention, candidates, critic reports, and curation receive partial hand-written checks. Gaps include:

- attention selection does not prove the returned observation came from the offered set;
- revised candidates and revised critiques bypass the initial validators;
- audience predictions, memory consolidation, and artifact audits lack full output validation;
- event type, payload, transition, and schema version are not validated;
- the live provider requests JSON and parses it, but does not enforce a JSON Schema response contract;
- numeric ranges, additional fields, and cross-field constraints are inconsistently checked.

Every provider response must be rejected before persistence when invalid. Every newly written ledger event needs a versioned schema and legal-transition check.

### F-13 — Configuration contains inert or provider-dependent controls

- **Classification:** implementation defect
- **Severity:** high

Configuration is not validated as a complete schema. Notable issues include:

- `maximum_canon_works` is not enforced;
- `require_intention_lock` is not consulted because locking is unconditional;
- `allow_rejection` is not enforced by the host;
- `maximum_revision_rounds` acts as a boolean and cannot produce more than one round;
- score weights and thresholds have no bounds or normalization validation;
- deterministic curation enforces weights and thresholds, while live curation is only prompted to consider them;
- several constitutional commitments and refusal conditions are prompt context rather than host-enforced constraints.

Each field should be enforced, clearly declared advisory, or removed. Provider-dependent enforcement is an experimental variable and must be recorded.

### F-14 — Scoring can create apparent progress without independent improvement

- **Classification:** experimental confound
- **Severity:** high

The deterministic scoring path rewards input-derived motif recurrence, uses the same provider for evaluation and selection, and retains only selected outcomes in the main canon collection. Thresholding and survivorship can therefore raise selected scores without showing improvement in the underlying candidate distribution.

Normal candidate IDs include random cycle identifiers that feed stable-hash scoring, so ordinary deterministic runs are not reproducible from the same semantic inputs. Fixed experiment IDs improve repeatability but do not remove self-referential scoring. No sensitivity analysis tests whether conclusions survive reasonable weight or threshold changes.

### F-15 — Claimed causal links to earlier evidence are not auditable

- **Classification:** unsupported inference
- **Severity:** critical

Preserved surprises record a candidate ID and description but no source event hash, evidence type, artifact deviation, or verification status. Motif counts have no evidence provenance. Memory output includes a lesson and future obligation in the event/file, but those fields are not projected into later role state. No later cycle records whether it used, rejected, or transformed a prior surprise, review, audit finding, or work.

Temporal availability of earlier state is not evidence of causal use. Every autobiographical claim needs typed source identity and a later disposition record.

### F-16 — Manifests are insufficient for exact provenance

- **Classification:** missing validation
- **Severity:** high

Manifests record the provider name, selected data, intention hash, constitution version, feature flags, and artifact path. They do not reliably record exact provider/model IDs per role, prompt and schema versions, request IDs, generation parameters, source commit, artifact hash, or ledger event identities. Artifact paths are absolute, reducing portability and causing forked copies to retain references outside the fork.

Exact reproduction may still be impossible for stochastic providers, but the inputs and identities required to audit an attempt should be preserved.

### F-17 — Intention ordering is sound, but lock identity is retry-unstable

- **Classification:** state-integrity risk
- **Severity:** medium

The normal path persists `intention_locked` before candidate generation, and the current test proves that ordering. The lock hash includes `locked_at`, however, so retrying semantically identical intention content produces a different hash. There is also no transition rule preventing multiple locks for one cycle.

The content commitment should be stable and separately identify its event/time metadata. The state machine should permit exactly one effective intention lock unless an explicit supersession event is defined.

### F-18 — Hash-chain verification does not provide transaction or concurrency safety

- **Classification:** future scalability concern
- **Severity:** high

The ledger verifies sequence numbers, predecessor hashes, and event hashes. It does not lock append operations, validate event semantics, or prevent concurrent writers from reading the same head and appending conflicting next sequences. The entire ledger is read for each append.

The current single-process use avoids many races, but provider callbacks, HTTP control paths, or future workers make this fragile. Append serialization and atomic head handling are needed before concurrent use.

### F-19 — Fork isolation is only tested in the single-writer case

- **Classification:** future scalability concern
- **Severity:** medium

Forking copies the studio and appends `studio_forked` only in the copy. The existing test confirms the fork ledger is valid and does not store an absolute parent-studio path in that event. It does not verify byte-for-byte parent immutability or behavior when the parent changes during the copy. Absolute artifact paths can also continue to reference parent storage.

A fork should be based on a verified, named parent ledger head and should use content-addressed or fork-relative artifacts. Concurrent parent mutation must be blocked or detected.

### F-20 — Current tests can be overinterpreted as research evidence

- **Classification:** unsupported inference
- **Severity:** high

The tests are useful mechanical checks. They do not establish that motifs came from outputs, that surprise was discovered after a result, that artifact or human evidence changed a later decision, that roles are independent, or that scores reflect improvement. The two-cycle “memory” test only observes nonempty motif/tension collections, which the input-tag mechanism can satisfy.

Test and README language should consistently say “tests mechanics and invariants,” not imply validation of trajectory or creative development.

### F-21 — “Deterministic” operation is not fully reproducible in ordinary runs

- **Classification:** documentation mismatch
- **Severity:** medium

The provider is deterministic for identical serialized inputs, but ordinary cycle inputs contain generated UUIDs and timestamps. Candidate IDs derived from cycle IDs affect hash-based scores, and intention hashes include lock time. Two fresh offline runs with semantically identical observations may therefore differ.

Documentation should distinguish offline/no-network behavior from reproducibility. Reproducible runs require explicit seeds or stable identifiers and a recorded clock strategy.

## What the current tests prove

The 18 passing tests demonstrate the following within their tested paths:

- archiving renames an existing studio without changing ledger bytes, and a missing studio is a no-op;
- concept-only and artifact-audit-passed status values are distinguishable;
- artifact generation/audit events appear in the mocked artifact path;
- invalid experiment conditions and missing live-provider API keys fail before studio initialization;
- an intention event precedes candidate events and contains a hash;
- two deterministic cycles populate motif/tension structures;
- a normal single-writer fork has a valid ledger and omits an absolute parent path from the fork event;
- ledger sequence/hash verification detects tested tampering;
- mailbox direct/HTTP modes accept valid messages and reject tested malformed messages;
- mocked live-provider JSON parsing and base64 image writing work, and an API key is required;
- rebuilding a simple completed cycle recovers selected counts and statuses;
- a consented human review appears in the report and review statistics;
- one configured revision creates the expected event trail and can end in rejection.

## What the current tests do not prove

They do not prove:

- a legal lifecycle or exactly one terminal cycle state;
- crash-boundary recovery or safe, idempotent retry;
- state/ledger-head agreement at startup;
- deep equality between live and rebuilt projections;
- deterministic rebuild across randomized event sequences;
- schema validity for every provider output or event payload;
- post-result evidence for surprise;
- evidence-based motif formation;
- causal use of artifact audits or human reviews;
- hard separation of simulated and human audience evidence;
- isolation of one feature per ablation;
- robustness to scoring weights and thresholds;
- independent or blinded role judgments;
- provider/model/prompt reproducibility;
- artifact content integrity or hash provenance;
- fork immutability under concurrent parent writes;
- network-provider behavior, subjective quality, trajectory, or improvement.

## Validation results for this audit

All commands ran from a fresh clone on `audit/logic-integrity`, without live API access:

| Command | Result |
|---|---|
| `npm ci` | Passed; one package audited, zero vulnerabilities |
| `npm run check` | Passed; JavaScript syntax, JSON parsing, and local Markdown links |
| `npm test` | Passed; 18 tests |
| `npm run validate` | Passed |
| `npm run demo` | Passed; five offline cycles, valid ledger |
| `npm run cycle` | Passed; one offline cycle, valid ten-event ledger |
| `npm run doctor` | Passed for the generated local studio |
| `npm run verify` | Passed for the generated local studio |
| `npm run experiment:smoke` | Passed mechanically; all six conditions completed |
| `npm audit --audit-level=high` | Passed; zero vulnerabilities |
| `npm pack --dry-run --json` | Passed; package `haunted-studio@0.1.0`, 65 entries before this audit document |

Generated studios and experiment outputs remained ignored. The audit found no reason to add a live call: live-provider behavior remains unvalidated by these offline results.

## Proposed pull-request boundaries

The following PRs should remain separate and should be reviewed and merged in order. Each behavioral correction should begin with a failing test. None should weaken existing assertions.

### PR 1 — Lifecycle and data integrity

Scope:

- define a legal cycle state machine and validate transitions;
- enforce exactly one terminal state;
- add cycle operation identity, idempotency, and explicit resume/retry behavior;
- store ledger-head sequence, event ID, and hash in projected state;
- verify projected state against the ledger at startup;
- rebuild automatically only when policy permits, otherwise require explicit recovery;
- make one reducer authoritative for live updates and replay;
- add event schema versions and reject invalid new event transitions;
- add crash-boundary tests around every persisted event/file/state boundary;
- add retry, duplicate-cycle, stale-state, and rebuild-equality tests.

Compatibility approach:

- do not rewrite the append-only ledger;
- read legacy unversioned events through a documented version-0 adapter;
- write only versioned events after migration;
- add projected-state schema/version metadata and rebuild legacy state from its verified ledger;
- require an explicit backup/archive before any migration that cannot be performed by replay.

Exit criteria include one terminal event per cycle, duplicate-operation no-ops or safe resumes, and byte-stable deterministic projection from a valid ledger.

### PR 2 — Research-semantic integrity

Depends on PR 1's event and projection contracts.

Scope:

- remove predeclared proposed accidents from discovered-surprise logic;
- create typed evidence for anticipated risk, planned ambiguity, artifact deviation, random error, and productive surprise;
- require post-result evidence before preserving productive surprise;
- record later use, rejection, or transformation of preserved evidence;
- separate input tags, intended motifs, artifact-observed motifs, and human audience findings;
- replace the single canon collection with typed concept, artifact, failure, unfinished, and refusal records;
- route artifact audits and consented human reviews into memory as typed provenance-aware evidence;
- enforce that simulated predictions cannot satisfy human-evidence fields;
- add tests for every related required invariant.

No output should be reclassified retroactively without an explicit migration event preserving the original record.

### PR 3 — Experimental integrity

Depends on the typed semantics from PR 2.

Scope:

- make every basic ablation alter exactly one declared feature;
- split no-refusal from no-revision;
- document and implement no-memory/no-surprise as independent, nested, or factorial conditions;
- define whether memory ablation affects formation, retrieval, or both;
- add weight/threshold sensitivity tests and report full candidate distributions;
- support blind candidate identifiers and randomized ordering;
- support per-role provider/model configurations;
- record exact provider/model identifiers, prompt/schema versions, request IDs when available, parameters, code commit, and artifact hashes;
- flag ablations that do not affect a provider's actual decision path.

Experiment results should report design limitations and should not infer trajectory from acceptance rates or internal judge scores alone.

### PR 4 — Test-strength tooling

Depends on stable schemas and lifecycle semantics from PRs 1–3.

Scope:

- add Ajv JSON Schema validation for every provider response and ledger-event type;
- add fast-check property/model tests for lifecycle, crash, retry, rebuild, fork, review, and corruption sequences;
- add StrykerJS mutation testing focused initially on ledger, lifecycle, artifact status, evidence typing, and ablation logic;
- add a least-privilege CodeQL JavaScript workflow;
- propose a small TLA+ specification covering lifecycle, ledger projection, crash recovery, and retry invariants.

Mutation thresholds should be introduced from a measured baseline, with surviving mutations reported rather than hidden. A passing TLA+ model would validate the model under its bounds and assumptions; it would not formally verify the JavaScript implementation.

## Review gates

For each proposed PR:

1. Add failing tests that reproduce the defect or missing invariant.
2. Make the smallest behavioral correction within that PR's boundary.
3. Run the complete existing validation suite plus the new targeted tests.
4. Report negative results, surviving mutations, unsupported assumptions, and migration effects.
5. Request a separate Codex review.
6. Do not merge automatically.

## Conclusion

Haunted Studio currently provides a runnable offline orchestration prototype, a useful append-only provenance mechanism, and testable role boundaries. Its present data model and experiments are not yet sufficient to determine whether prior work, post-result surprise, criticism, human interpretation, and irreversible history caused a recognizable later trajectory. The four proposed PRs address lifecycle correctness first, then research semantics, experimental isolation, and finally stronger verification tooling. That order avoids building research claims on an ambiguous state model.
