# Cycle lifecycle and ledger-event compatibility

This document defines the event legality contract for newly written Haunted
Studio ledger events. It describes runtime mechanics and does not make claims
about creative quality or development.

## Event schema versions

Every newly appended event has top-level `schema_version: 1`. Version 1 checks,
before persistence:

- the event type is registered;
- the actor is a non-empty string;
- the payload is an object;
- cycle-scoped events have a non-empty cycle identity;
- global events do not have a cycle identity;
- the event is legal at the cycle's current lifecycle position.

An append that fails validation does not write a ledger line. Appends to the
same canonical ledger path are serialized within one Node.js process, so two
concurrent terminal attempts cannot both validate against the same head.
Separate operating-system processes are not coordinated; running multiple
writers against one studio is unsupported and remains a documented risk.

### Version-0 compatibility

Events written before this contract have no `schema_version` field. They are
read as version 0 through an in-memory compatibility adapter. The adapter does
not add a field to the stored event, rewrite its line, or change its hash input.
Hash-chain verification therefore continues to verify the original bytes and
canonical event content.

Version-0 events remain readable and verifiable. All later appends are version
1. The application does not silently upgrade an existing ledger. Unknown
historical version-0 event payloads are retained as historical data; the strict
registered-type and transition checks apply to new version-1 writes.

## Cycle state machine

A cycle begins with `cycle_started`. It has at most one terminal event:

- `cycle_completed`; or
- `cycle_failed`.

`cycle_abandoned` is not defined because the current execution model has no
separate abandonment operation.

`cycle_failed` is legal after any nonterminal lifecycle event. It is not legal
before `cycle_started` or after another terminal event. `cycle_completed` is
legal only immediately after `memory_consolidated`.

The normal and optional forward transitions are:

| Current event | Allowed next non-failure event(s) |
|---|---|
| `cycle_started` | `observation_selected` |
| `observation_selected` | `intention_locked` |
| `intention_locked` | `candidates_generated` |
| `candidates_generated` | `critics_reported` |
| `critics_reported` | `curation_decided` |
| `curation_decided` with `accept` | `artifact_generated`, `audience_predicted`, or `memory_consolidated` |
| `curation_decided` with `revise` | `candidate_revised` or `curation_overridden_by_condition` |
| `curation_decided` with `reject_all` | `memory_consolidated` or `curation_overridden_by_condition` |
| `curation_overridden_by_condition` | `artifact_generated`, `audience_predicted`, or `memory_consolidated` |
| `candidate_revised` | `revision_critiqued` |
| `revision_critiqued` | a final `curation_decided` |
| `artifact_generated` | `artifact_audited` |
| `artifact_audited` | `artifact_audit_not_passed`, `audience_predicted`, or `memory_consolidated` |
| `artifact_audit_not_passed` | `audience_predicted` or `memory_consolidated` |
| `audience_predicted` | `memory_consolidated` |
| `memory_consolidated` | `cycle_completed` |

At most one effective `intention_locked` event and one `candidate_revised`
event are allowed. At most two `curation_decided` events are allowed: the
initial decision and, when revision occurs, the final decision. A final
curation decision cannot request another revision. An override is legal only
after `revise` or `reject_all` and must change the effective decision to
`accept`.

The lifecycle validator rejects:

- cycle events before `cycle_started`;
- duplicate starts;
- out-of-order or skipped lifecycle events;
- duplicate effective intention locks;
- duplicate revision events or excess curation rounds;
- revision, artifact, audience, or memory transitions that contradict the
  recorded curation decision;
- completion before memory consolidation;
- duplicate terminal events;
- completion after failure or failure after completion;
- ordinary cycle events after either terminal outcome.

## Post-cycle events

Only these event categories may name a cycle after its terminal event:

| Event | Required terminal state |
|---|---|
| `mailbox_observations_consumed` | `cycle_completed` |
| `human_review_recorded` | `cycle_completed` |
| `memory_corrected` | `cycle_completed` or `cycle_failed` |

`memory_corrected` may alternatively omit a cycle identity when its target is a
global historical event. These post-cycle events do not change the cycle's
terminal outcome.

## Stable intention commitment

The intention commitment hashes only the semantic content fixed before
candidate generation:

- observation identity;
- necessity statement and supporting fields;
- locked intention fields.

The cycle identity, `locked_at` timestamp, ledger event identity, sequence, and
event hash are metadata and are excluded from the content commitment. The
`intention_locked` payload stores the commitment as `intention_commitment` and
retains `intention_hash` as a compatibility alias. The public cycle result also
retains `intentionHash`.

## Failure after completion persistence

If projected-state saving or final verification throws after
`cycle_completed` was appended, the engine rethrows the error but does not add
`cycle_failed`. The ledger therefore retains one terminal outcome. Detecting
and recovering a stale projection is intentionally deferred to the separate
projection-recovery work; this lifecycle contract does not silently rebuild or
rewrite state.

## Deliberately deferred work

This contract does not implement:

- projected ledger-head identity or startup freshness checks;
- state rebuild policy, crash recovery, resume, or operation idempotency;
- comprehensive JSON Schema validation of role responses or event payloads;
- changes to surprise, motif, memory, canon, audience, critic, scoring, or
  ablation semantics.

Those concerns belong to later independently reviewed pull requests.
