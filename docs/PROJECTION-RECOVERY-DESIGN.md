# Projection recovery and idempotency design

Status: implementation contract for PR 1B. This design changes state and
recovery mechanics only. It does not change research semantics.

## Authority and reducer

`ledger.jsonl` is authoritative. `state.json` is a disposable, deterministic
projection of a verified ledger. One pure reducer, `projectLedger(events)`, is
used for live updates, startup recovery, explicit rebuild, and test reference
behavior. No command or engine path may update projected artistic state by
hand.

The reducer applies artistic effects from a cycle only when that cycle has a
legal `cycle_completed` event. Earlier observation, intention, candidate,
criticism, curation, artifact, audience-prediction, and memory events remain
provenance for an incomplete or failed cycle but do not change committed
canon, motifs, memory, trajectory counts, or rejection counts.

Explicit post-cycle projection effects are limited to:

- `human_review_recorded` -> consented audience findings;
- `memory_corrected` -> correction records;
- `studio_forked` -> branch provenance.

`mailbox_observations_consumed` records idempotent consumption but has no
artistic projection effect. Simulated audience predictions remain cycle data,
not human-review evidence.

## Projected ledger head

State schema version 2 stores:

```json
{
  "ledger_head": {
    "sequence": 12,
    "event_id": "evt_...",
    "event_hash": "...",
    "schema_version": 1
  }
}
```

The head identifies the exact last ledger event represented by the projection,
including events that have no artistic projection effect. The genesis/empty
projection uses sequence 0, no event ID, the ledger genesis hash, and schema
version 0.

## Startup decision table

Startup verifies the entire ledger before reading or rebuilding state.

| Condition | Decision |
|---|---|
| Ledger invalid | Stop with an integrity error. Do not rebuild or append. |
| Ledger empty, state missing | Initialize the ledger, reduce it, and save the projection. |
| State missing, ledger valid | Rebuild from the full ledger and report `missing_state_rebuilt`. |
| State head exactly matches ledger head and content matches reduction | Continue and report `matched`. |
| State head is a valid earlier ledger head | Rebuild and report `stale_state_rebuilt`. |
| State claims a sequence beyond the ledger | Stop with an ahead-of-ledger integrity error. |
| State head identity does not match the event at its claimed sequence | Stop with a divergent-state integrity error. |
| State predates head identity | Use the explicit legacy compatibility path: rebuild from the verified ledger and report `legacy_state_rebuilt`. Never assume it is current. |
| Head matches but state content differs from reduction | Rebuild and report `content_mismatch_rebuilt`. |

Recovery status is returned as process metadata; it is not embedded as
nondeterministic state. Rebuilding never edits or truncates the ledger.

## Incomplete cycles

The reducer lists cycles that have `cycle_started` but no terminal event in
`incomplete_cycles`. Their intermediate effects are excluded from committed
state. Startup may safely rebuild the projection but must not silently start a
new cycle while an incomplete cycle exists.

An incomplete operation has two explicit paths:

1. Resume it with the same operation identity and matching request
   fingerprint. The engine continues from persisted events.
2. Abandon it explicitly. Abandonment appends the lifecycle's legal
   `cycle_failed` event with recovery provenance; no history is removed.

No new `cycle_abandoned` event is introduced because PR 1A intentionally uses
`cycle_failed` for a terminated incomplete operation.

## Retry, resume, restart, and rebuild

- **Retry** repeats an external request with the same operation identity.
  Completed identical operations return their recorded result. A different
  payload is a conflict.
- **Resume** is an explicit continuation of an incomplete cycle. Persisted
  role outputs and the original intention commitment are reused. Provider or
  artifact calls with valid recorded results are not repeated.
- **Restart** starts a new process. Startup verification and projection policy
  run before any operation continues.
- **Rebuild** runs the pure reducer against a valid ledger and atomically
  replaces only `state.json`. It does not call providers, resume a cycle, or
  append/modify ledger history.

A normal caught provider or validation error appends `cycle_failed` and is not
resumable. A process crash can leave a nonterminal cycle; test-only deterministic
failure injection models that boundary without appending failure.

## Operation identity and conflicts

Externally retryable writes carry:

- a non-empty `operation_id`;
- an `operation_fingerprint`, computed from canonical request content.

This applies to creative-cycle requests, human-review recording, memory
corrections, mailbox-consumption recording, and explicit abandonment. When an
operation identity already exists:

- the same fingerprint and completed result returns that result without a new
  event;
- the same fingerprint and incomplete cycle requires explicit resume;
- a different fingerprint is rejected as a conflict;
- a terminal failed cycle is returned/reported as failed and is not rerun.

Generated event IDs, review IDs, timestamps, and file paths are excluded from
request fingerprints. When callers omit an operation identity, a new one is
generated for backward compatibility; only caller-supplied stable identities
provide retry idempotency.

## Resume checkpoints

The cycle resumes after the latest valid persisted lifecycle event. It loads
recorded payloads for observation, intention, candidates, criticism, curation,
revision, artifact record, artifact audit, audience prediction, and memory.
Only missing subsequent work is performed. The resumed execution retains the
original cycle ID, operation ID, intention commitment, and recorded outputs.

Completion is never appended twice. If completion was appended but state saving
failed, startup rebuilds state and a retry returns the recorded completed
result.

## Crash-boundary contract

Deterministic tests inject abrupt failure after these persisted boundaries:

- cycle start;
- observation selection;
- intention lock;
- candidate generation;
- criticism;
- curation;
- revision;
- artifact record;
- artifact audit;
- audience prediction;
- memory consolidation;
- completion append;
- projected-state save;
- human-review event append;
- memory-correction event append.

After restart, the ledger must verify, startup must follow the decision table,
and explicit retry/resume must not duplicate events or projection effects.

## Compatibility and limits

Version-0 ledger events remain unchanged and are reduced by event type. A
pre-PR-1B state file has no head identity and therefore always takes the
documented legacy rebuild path. Existing state is never trusted by cycle count
alone.

Append serialization remains limited to one Node.js process and one resolved
path. Multi-process writers and symlink aliases remain unsupported. This PR
does not add comprehensive JSON Schema tooling, cross-process locking, or any
research-semantic change.
