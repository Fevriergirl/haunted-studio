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
   optional image generation + audit
                |
 simulated audience prediction -> consented human review
                |
       memory consolidation
                |
 append-only ledger + rebuildable state
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for component and trust
boundaries.

## Creative cycle

1. Select an observation.
2. State why a work might be necessary.
3. Lock and hash the intention.
4. Generate distinct candidate concepts.
5. Critique each candidate against the intention, constitution, and history.
6. Accept, revise once, or refuse all candidates.
7. Optionally generate and audit an image.
8. Predict a possible audience encounter.
9. Record consented human responses separately when available.
10. Consolidate memory without rewriting the ledger.

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

Model names are configurable because account access and availability change.
Missing `OPENAI_API_KEY` fails before a studio cycle is written.

Official API guides:

- [Responses API](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Image generation](https://developers.openai.com/api/docs/guides/image-generation)

## Commands

| Command | Purpose |
|---|---|
| `npm run cycle` | Run one creative cycle |
| `npm run status` | Print projected studio state |
| `npm run verify` | Verify the ledger hash chain |
| `npm run report` | Write a trajectory report |
| `npm run doctor` | Check runtime, configuration, provider, ledger, and projection |
| `npm run demo` | Run five offline deterministic cycles |
| `npm run experiment -- 5 experiments/run-001` | Run all six ablation conditions |
| `npm run experiment:smoke` | Run one deterministic cycle per condition |
| `npm run serve` | Start the loopback observation mailbox |
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

The ledger is authoritative. Rebuild a lost or stale projection with:

```bash
node src/cli.js rebuild-state
npm run verify
```

## Safe reset and forks

`npm run reset` moves the entire studio directory to a timestamped sibling
archive. It does not silently delete the ledger.

Fork an existing history for path-dependence research:

```bash
node src/cli.js fork .haunted-studio-branch-a "different observations"
```

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
