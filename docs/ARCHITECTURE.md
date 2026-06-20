# Architecture

## System boundary

Haunted Studio is one Node.js orchestration process with explicit role
boundaries. The attention, artist, critic, curator, audience-prediction, and
memory modules are not independent services and do not possess independent
agency. A provider supplies deterministic fixtures or optional model responses
for those roles.

## Components

### Studio and ledger

`Studio` owns the runtime directory, rebuildable state projection, work files,
and append-only hash-linked ledger. `ledger.jsonl` is authoritative;
`state.json` is a convenience projection. Newly written events follow the
versioned legality contract in [Cycle lifecycle and ledger-event
compatibility](LIFECYCLE.md); existing unversioned events remain version-0
history and are not rewritten.

### Attention role

Ranks observations using recurrence, novelty, unresolved tension, and
saturation. The assigned-attention experiment bypasses this selection.

### Artist role

Forms a functional necessity statement, locks an intention, and produces
candidate concepts. The intention is hashed before candidates exist.

### Criticism and curation roles

Criticism scores candidates against formal, truth, historical, adversarial, and
surprise criteria. Curation may accept, request one revision, or refuse all
candidates. These are software role boundaries, not independent reviewers.

### Artifact generation and audit

Image generation is optional. Concept acceptance does not imply that an image
exists. A generated file must pass a separate artifact audit to receive
`artifact_audit_passed`; this internal status does not establish artistic merit.

### Audience prediction and human review

Audience prediction is simulated provider output written before review.
Consented human responses are separately identified ledger events and files.
Reports must not combine the two as if they were equivalent evidence.

### Memory role

Updates motifs, unresolved tensions, observation counts, and preserved
surprises in projected state. It cannot edit prior ledger events.

### Observation mailbox

The custom HTTP mailbox accepts local observation signals and persists them in
JSONL until acknowledgment. It is not an A2A standards implementation. It binds
to loopback by default and is not safe for public exposure.

## Trust boundaries

- Provider output, observations, reviews, images, and paths are untrusted data.
- API keys remain in process environment variables and are never written by the
  application.
- Human reviews require explicit consent and should use pseudonymous IDs.
- External observations require source and rights metadata.
- Ledger hashes detect modification; they do not prevent concurrent-write races
  or guarantee that an event's claims are true.
- Runtime data is ignored by Git but still requires filesystem access controls.

## Failure and recovery

- A failed nonterminal cycle appends `cycle_failed` with a bounded error
  description. A completed cycle cannot later receive `cycle_failed`.
- Ledger verification detects sequence, previous-hash, and content-hash changes.
- State can be rebuilt from completed ledger events.
- User-facing reset archives the entire runtime directory before a new run.
- Experiment runners delete only their own explicitly generated condition state.
