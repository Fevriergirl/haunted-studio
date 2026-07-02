# Haunted Studio

[![CI](https://github.com/Fevriergirl/haunted-studio/actions/workflows/test.yml/badge.svg)](https://github.com/Fevriergirl/haunted-studio/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Haunted Studio is an experimental persistent artificial creative system. It is
a Node.js research prototype for testing whether prior work, unresolved
tensions, criticism, audience interpretation, and irreversible history can
alter what a role-separated creative process produces next.

## What it is not

Haunted Studio is not an autonomous person, a conscious artist, or evidence of
subjective experience. Its references to attention, necessity, surprise,
memory, or intention are functional approximations implemented in software.
Model-generated first-person language is not evidence of feeling, inspiration,
suffering, authorship, or a muse.

The project has not demonstrated genuine artistic development. It provides
mechanisms and experiments with which that hypothesis can be tested.

## Research question

> Can a persistent artificial creative system develop a recognizable trajectory
> when previous work, unresolved tensions, criticism, audience interpretation,
> and irreversible history alter what it produces next?

Supporting evidence would require repeated live-model runs, controlled
ablations, path-dependent forks, blinded human review, and later decisions that
can be traced to earlier accepted work, refusals, or preserved surprises.
Evidence weakens the hypothesis when outputs remain interchangeable, memory
ablation has no effect, motifs become superficial branding, refusals are
unstable, or claimed surprises do not influence later choices.

## Current status

Version `0.1.0` is the first standalone release of the research prototype.

The deterministic provider and automated tests validate mechanics and
invariants. They do not validate artistic quality or trajectory. The optional
OpenAI provider is covered by mocked HTTP tests; this repository's release
validation did not make paid API calls or generate a live image.

## Capabilities

- selects from an observation stream using a dedicated attention role;
- forms a stated necessity and hashes a locked intention before generation;
- generates several distinct candidate concepts;
- separates generation, criticism, curation, audience prediction, and memory
  consolidation into role modules within one process;
- permits one revision or a refusal of all candidates;
- optionally generates an image and audits the image that actually exists;
- records a blind post-result witness description, deviation comparison, and
  adversarial surprise review before artifact audit;
- keeps concept acceptance separate from passage of the artifact audit;
- records simulated audience predictions separately from consented human
  reviews;
- maintains an append-only SHA-256 hash-linked event ledger;
- rebuilds projected state from the authoritative ledger;
- forks studio history for path-dependence experiments;
- runs six feature-ablation conditions; and
- accepts local external observations through a custom HTTP mailbox.

## Limitations

- This is a single-process local prototype, not a distributed multi-agent
  system.
- Role separation is architectural; roles are not independent services.
- The custom observation mailbox is not an implementation of an A2A standard.
- Ledger appends and mailbox updates are not designed for concurrent writers.
- The mailbox has no authentication and must remain loopback-only by default.
- The deterministic provider emits reproducible fixtures, not independent
  creative evidence.
- Live-model and image behavior depends on configured model availability and
  has not been validated by the offline CI suite.
- Human evaluation, preregistration, reviewer randomization, and meaningful
  sample sizes remain future work.

## Architecture

```text
observation stream / local mailbox
                |
          attention role
                |
       necessity + locked intention
                |
          generation role
                |
          criticism roles
                |
   curator: accept / revise / refuse
                |
 optional image generation
                |
 blind witness -> deviation comparison -> adversarial surprise review
                |
          artifact audit
                |
 simulated audience prediction -> consented human review
                |
       memory consolidation
                |
 append-only ledger + rebuildable state
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for component and trust
boundaries.
See [post-result evidence design](docs/POST-RESULT-EVIDENCE-DESIGN.md) for the
evidence vocabulary, blindness contract, and compatibility behavior.

## Creative cycle

1. Select an observation.
2. State why a work might be necessary.
3. Lock and hash the intention.
4. Generate distinct candidate concepts.
5. Critique each candidate against the intention, constitution, and history.
6. Accept, revise once, or refuse all candidates.
7. Optionally generate an image and record its content hash.
8. Blindly witness the result, compare deviations to the plan, and challenge
   any provisional surprise.
9. Audit the artifact, or explicitly record that post-result evidence is
   unavailable for a conceptual-only cycle.
10. Predict a possible audience encounter.
11. Record consented human responses separately when available.
12. Consolidate memory without rewriting the ledger.

Concept acceptance produces `conceptual_only`. An image becomes
`artifact_audit_passed` only when an audit of the generated file recommends
acceptance and meets the configured threshold. This status verifies an internal
audit condition, not artistic merit.

## Requirements and installation

- Node.js 20 or 22
- npm

```bash
git clone https://github.com/Fevriergirl/haunted-studio.git
cd haunted-studio
npm ci
npm run validate
```

There are currently no third-party runtime dependencies.

## Offline quick start

```bash
npm run demo
```

The demo runs five deterministic cycles and writes an ignored report under
`.haunted-studio-demo/`.

For a persistent local studio:

```bash
npm run cycle
npm run status
npm run verify
npm run report
```

## Studio interface (watch it make art)

A thin, zero-dependency local interface for turning an idea into one piece of art
and seeing how it was made. Defaults to a **Practice** (mock) provider, so it
works with no API key.

**Open it — pick whichever is easiest:**

- **One click (no terminal):** double-click **`Open Haunted Studio.command`**
  (macOS / Linux) or **`Open Haunted Studio.bat`** (Windows) in this folder. It
  starts the studio and opens your browser. (One-time setup: install
  [Node.js](https://nodejs.org), then run `npm install` once.)
- **One command:** `npm run studio` — it prints a banner and opens the page for
  you automatically.
- **A link to bookmark:** while the studio is running, the page lives at
  **http://localhost:19830/studio**. Bookmark it, or add it to your phone/desktop
  home screen. (It only works while the studio is running on your computer — it
  is local, not on the public internet.)

In the browser: type an idea, choose **Practice** (free, no key) or **Real
image**, press **Make art**, then **Keep it / Discard it / Not sure**. A friendly
**How this was made** section explains the role-separated, independently-reviewed
process, with the full verified record behind a toggle.

For real images, the page's **Real image** option takes an API key (held **in
server memory only** — never written to disk or returned), a model, and a
**Check it works** button — no environment variables required. Run one cycle from
the CLI instead:

```bash
node src/cli.js run --seed "a kitchen that quietly refuses to be entered"
```

Artifacts and a metadata sidecar are saved under
`<studio>/artifacts/cycles/<cycleId>/`. For real images, set
`HAUNTED_STUDIO_ARTIFACT=image` and provide an OpenAI-images-compatible endpoint:

```bash
export HAUNTED_STUDIO_ARTIFACT=image
export HAUNTED_STUDIO_IMAGE_API_KEY=sk-...          # required; never logged or stored
export HAUNTED_STUDIO_IMAGE_BASE_URL=https://api.openai.com/v1   # optional
export HAUNTED_STUDIO_IMAGE_MODEL=gpt-image-2       # optional
npm run studio
```

The key is read only from the environment, never written to metadata or logs, and
redacted from any error message. Mock mode remains the default and needs no key.
See [docs/IMAGE-MODE-TESTING.md](docs/IMAGE-MODE-TESTING.md) for exactly what has
been verified live versus what still needs a real provider key.

The interface has no authentication and is intended for local use only. It binds
to `127.0.0.1` and rejects non-loopback `Host` headers; **do not** set
`HAUNTED_STUDIO_HOST=0.0.0.0` or otherwise expose it to a network.

## Optional live-model configuration

A ChatGPT subscription does not include API usage. API access and billing are
separate. Copy `.env.example` only as a reference; this project does not load
`.env` files automatically.

Set secrets in your shell or approved secret manager:

```bash
export HAUNTED_STUDIO_PROVIDER=openai
export OPENAI_API_KEY=replace_me
export OPENAI_TEXT_MODEL=gpt-5.5
export OPENAI_IMAGE_MODEL=gpt-image-2
npm run cycle
```

Add `--image` to request image generation:

```bash
node src/cli.js run --image
```

PR 2A intentionally adds no live witness/comparator/reviewer API calls. A live
image cycle therefore requires separately configured post-result role providers
through the programmatic cycle interface. The CLI fails before creating studio
state rather than treating the artist's plan or artifact audit as blind witness
evidence.

Model names are configurable because account access and availability change.
Missing `OPENAI_API_KEY` fails before a studio cycle is written.

Official API guides:

- [Responses API](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Image generation](https://developers.openai.com/api/docs/guides/image-generation)

## Commands

| Command | Purpose |
|---|---|
| `npm run cycle` | Run one creative cycle; add `-- --operation-id <id>` for retry safety |
| `npm run status` | Print projected studio state |
| `npm run verify` | Verify the ledger hash chain |
| `npm run report` | Write a trajectory report |
| `npm run doctor` | Check runtime, configuration, provider, ledger, and projection |
| `npm run demo` | Run five offline deterministic cycles |
| `npm run experiment -- 5 experiments/run-001` | Run all six ablation conditions |
| `npm run experiment:smoke` | Run one deterministic cycle per condition |
| `npm run serve` | Start the loopback observation mailbox |
| `npm run studio` | Start the local studio art-loop interface (mock by default) |
| `node src/cli.js run --seed "<idea>"` | Run one studio art cycle from the CLI |
| `npm run reset` | Archive the current studio directory before starting over |
| `npm run check` | Syntax-check JavaScript and validate project JSON/metadata |
| `npm test` | Run isolated offline tests |
| `npm run validate` | Run static checks and tests |

Additional CLI commands are documented in the relevant sections below.

## Data and ledger locations

The default ignored runtime directory is `.haunted-studio/`:

```text
.haunted-studio/
|-- ledger.jsonl        authoritative append-only event history
|-- state.json          rebuildable current projection
|-- mailbox.jsonl       local observation queue
|-- reviews/            consented human review records
|-- reports/            generated reports
`-- works/              per-cycle intentions, candidates, audits, and manifests
```

The ledger is authoritative. State records the exact ledger sequence, event ID,
event hash, and event schema version it projects. Startup verifies the ledger
and automatically rebuilds missing, legacy, or safely stale state. It stops on
an invalid ledger, an ahead-of-ledger state, or divergent head identity.

An explicit rebuild is also available:

```bash
node src/cli.js rebuild-state
npm run verify
```

Use a stable operation identity for an externally retryable cycle:

```bash
node src/cli.js run --operation-id cycle-request-001
```

If a process stopped after a persisted nonterminal event, startup reports the
cycle in `incomplete_cycles`. Continue it explicitly without repeating recorded
provider outputs:

```bash
node src/cli.js run --operation-id cycle-request-001 --resume
```

Or terminate the incomplete operation by appending a legal `cycle_failed`
recovery event:

```bash
node src/cli.js abandon cycle-request-001 --operation-id abandon-request-001
```

A legacy incomplete cycle that predates operation identities cannot be resumed.
Terminate it explicitly by its recorded cycle identity:

```bash
node src/cli.js abandon --cycle-id cycle_legacy --operation-id abandon-request-legacy
```

The same `--operation-id` option applies to review, correct-memory, and fork
commands. Matching retries are no-ops; conflicting payloads are rejected.
See [projection recovery and idempotency](docs/PROJECTION-RECOVERY-DESIGN.md)
for the startup decision table and compatibility behavior.

## Safe reset and forks

`npm run reset` moves the entire studio directory to a timestamped sibling
archive. It does not silently delete the ledger.

Fork an existing history for path-dependence research:

```bash
node src/cli.js fork .haunted-studio-branch-a "different observations" --operation-id fork-request-001
```

Fork publication uses an operation-specific staging directory and verifies the
copied ledger head before the target path appears. Retry with the same operation
ID after an interrupted fork; do not manually repurpose staging directories.
Source-scoped operation claims are runtime recovery metadata and are archived
with the studio, not copied into the fork.

Run the fork with `HAUNTED_STUDIO_HOME` pointing to that directory.

## Experiments

The implemented experiment has six conditions:

1. full system;
2. no autobiographical memory;
3. assigned attention;
4. no refusal;
5. no audience prediction; and
6. no surprise carryover.

```bash
npm run experiment -- 30 experiments/preregistered-run
```

Short deterministic runs are smoke tests only. See
[docs/EXPERIMENT-PROTOCOL.md](docs/EXPERIMENT-PROTOCOL.md).

## Observations and human reviews

The loopback mailbox accepts external observation signals. It is a custom local
interface, not a standards-compliant A2A service:

```bash
npm run serve
curl -X POST http://127.0.0.1:19820/mailbox/receive \
  -H "Content-Type: application/json" \
  -d '{"type":"observation_signal","sender":"field-observer","payload":{"text":"A repaired clock keeps two incompatible times.","tags":["repair","time"],"rights":"project-authored"}}'
node src/cli.js run --mailbox
```

Use observations only when their source and rights are known.

To record a consented human review, copy
`docs/human-review.example.json`, replace the example values, and run:

```bash
node src/cli.js review <cycle-id> review.json
```

Audience predictions are simulated model output. Human reviews are separate
evidence and are never silently replaced by predictions.

## Testing

```bash
npm ci
npm run validate
npm run demo
npm run experiment:smoke
npm audit
npm pack --dry-run
```

Tests use temporary directories and mocked network responses. No test requires
an API key or live network service.

## Security, privacy, and provenance

- Keep the mailbox bound to `127.0.0.1` unless it has been production-hardened.
- Treat observations, model output, images, reviews, and generated reports as
  potentially sensitive.
- Do not commit `.env`, runtime directories, raw review data, or generated
  images.
- Confirm licensing, rights, and consent before using or publishing reference
  material or outputs.

See [SECURITY.md](SECURITY.md) and
[docs/DATA-AND-PROVENANCE.md](docs/DATA-AND-PROVENANCE.md).

## Ethical and authorship position

Haunted Studio records which provider, configuration, intention, critique,
curation decision, and human input contributed to a result. That provenance
does not settle artistic or legal authorship. Operators remain responsible for
consent, disclosure, licensing, publication, and claims made about the system.

## Roadmap

Priorities are evidence-driven:

1. preregister evaluation criteria and minimum sample sizes;
2. add blinded reviewer assignment and prediction-calibration measures;
3. run adequately powered live-model ablations and path-dependent forks;
4. test artifact revision after a failed image audit;
5. add concurrency controls before supporting multiple writers; and
6. publish negative and inconclusive results alongside positive findings.

## Origins and license

Haunted Studio was first prototyped inside another repository. This standalone
project has a fresh Git history; the original repository remains available as
historical provenance. See [docs/ORIGINS.md](docs/ORIGINS.md).

Licensed under the [MIT License](LICENSE).
