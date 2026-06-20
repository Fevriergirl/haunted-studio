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
`state.json` is a convenience projection produced by one reducer for live
updates, replay, and recovery. State records its exact ledger head. Newly
written events follow the
versioned legality contract in [Cycle lifecycle and ledger-event
compatibility](LIFECYCLE.md); existing unversioned events remain version-0
history and are not rewritten.

### Attention role

Ranks observations using recurrence, novelty, unresolved tension, and
saturation. The assigned-attention experiment bypasses this selection.

### Artist role

Forms a functional necessity statement, locks an intention, and produces
candidate concepts. The intention is hashed before candidates exist. Candidate
`planned_ambiguity` is an intentional hypothesis, not evidence of an accident
or surprise.

### Criticism and curation roles

Criticism scores candidates against formal, truth, historical, adversarial, and
surprise criteria. Curation may accept, request one revision, or refuse all
candidates. These are software role boundaries, not independent reviewers.

### Artifact generation, post-result evidence, and audit

Image generation is optional. Concept acceptance does not imply that an image
exists. After generation, a blind artifact witness receives only artifact
identity, hash, representation/path, and minimal technical context. A separate
comparator relates its observations to the locked plan, then an adversarial
reviewer may confirm, reject, or leave unresolved a proposed surprise. These
roles may share an offline provider object, but their call inputs remain
isolated. A generated file must then pass a separate artifact audit to receive
`artifact_audit_passed`; this internal status does not establish artistic merit.

### Audience prediction and human review

Audience prediction is simulated provider output written before review.
Consented human responses are separately identified ledger events and files.
Reports must not combine the two as if they were equivalent evidence.

### Memory role

Updates motifs, unresolved tensions, and observation counts in projected state.
PR 2A stops planned candidate fields from being promoted into surprise memory;
typed evidence-driven memory and later-use records are deferred to PR 2B. The
memory role cannot edit prior ledger events.

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
- Ledger hashes detect modification; they do not guarantee that an event's
  claims are true. Appends are serialized within one Node.js process, but
  separate processes must not write to the same studio concurrently.
- Runtime data is ignored by Git but still requires filesystem access controls.

## Failure and recovery

- A failed nonterminal cycle appends `cycle_failed` with a bounded error
  description. A completed cycle cannot later receive `cycle_failed`.
- Ledger verification detects sequence, previous-hash, and content-hash changes.
- Startup follows the explicit integrity decision table in [Projection recovery
  and idempotency](PROJECTION-RECOVERY-DESIGN.md).
- Incomplete-cycle intermediate events remain provenance but do not contribute
  committed memory, canon, motifs, or trajectory state.
- Resume reuses recorded stage outputs; abandonment appends `cycle_failed` and
  never removes history.
- User-facing reset archives the entire runtime directory before a new run.
- Experiment runners delete only their own explicitly generated condition state.
