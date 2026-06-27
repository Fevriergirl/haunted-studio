# Changelog

## Unreleased

- Block cross-site requests to the studio's state-changing endpoints. A
  malicious page could otherwise issue a CORS "simple request" (e.g.
  `Content-Type: text/plain`, which the server still parses as JSON) to a
  loopback endpoint and trigger an image cycle that spends the in-memory key's
  budget, or clear the key. The server now rejects any non-GET request whose
  `Sec-Fetch-Site` is present and not `same-origin`/`none` (browsers always send
  it and JS cannot forge it; non-browser clients omit it and are unaffected).
- Make the studio interface drive the whole setup/run flow from the browser: a
  Setup panel switches mock/image, takes the image API key (held in server memory
  only — never written to disk, returned, or logged), picks the model/size, and
  tests the connection (a free `/models` auth check). Per-run mode/model/size are
  passed to the provider via an in-process env override; the key is required for
  image cycles and redacted everywhere.
- Wire the real image provider behind the artifact-adapter seam: image mode now
  calls an OpenAI-images-compatible endpoint and saves a PNG, accepting either a
  base64 (`b64_json`) or a `url` response. Hardening: the API key is only ever sent
  to an https base URL (loopback http allowed for dev); a returned url is followed
  only over https, with redirects refused, IP-literal private/loopback hosts
  blocked, and a streamed size cap that bounds memory; credentials are read only
  from the environment and redacted from errors, and signed download urls are kept
  out of error messages. (The host block is best-effort against IP literals;
  domain names that resolve to private IPs are not caught.) Mock remains the
  default; the artifact extension and served content type follow the provider.
- Add a thin, zero-dependency local studio interface that runs one complete
  artist cycle and shows the result: enter a seed, see the brief, prompt,
  generated artifact, and reflection, then accept/reject/unresolved and watch
  canon/memory update. Includes a `mock` artifact provider (default, offline) and
  an `image` adapter seam reading credentials from the environment, a stdlib HTTP
  server (`npm run studio`), a `run --seed` one-shot, and artifact + metadata
  saved under `artifacts/cycles/<cycleId>/`. The human reject reuses the
  marked-not-erased canon revocation.
- Give fidelity adjudication teeth: after a cycle, an independent confirmed
  concealed deviation revokes the work's canon standing. Revocation is post-hoc
  and marks the canon entry (`revoked: true` + reason/verdict provenance) — the
  record is never erased. Offline/no-witness/no-provider cases never revoke, and
  reruns are idempotent. Wired into the CLI `run` flow and surfaced in the report.
- Fix the deterministic provider's scoring to depend only on stable content
  (observation, candidate index, strategy) instead of the random cycle id, so it
  is actually deterministic. Previously ~0.5% of runs scored every candidate
  below the curation threshold and rejected all of them, which flaked CI and
  broke experiment reproducibility.
- Require blind post-result artifact evidence and adversarial review before a
  deviation can be classified as productive surprise.
- Treat legacy `proposed_accident` fields as planned ambiguity rather than
  discovered evidence.
- Preserve version-0 and pre-evidence version-1 ledger compatibility without
  rewriting history.
- Add a standalone fidelity-adjudication module (research slice): frozen
  intention, maker self-report, non-authoritative independent signal detection,
  possible violation, adversarial challenge, and confirmed/rejected/unresolved/
  undetectable verdicts, with an inclusive canon-threshold correction. Not yet
  wired into the live cycle.
- Persist fidelity adjudication as post-cycle ledger events with
  defense-in-depth contract validation (commitment cannot be rewritten, the
  detector cannot carry a verdict, allegations must reference real signals, and
  a pixel-level claim cannot be confirmed from artifact-description evidence).
- Close a silent false-affirmation channel discovered by `scripts/fidelity-probe.js`:
  rhetorical or counterfactual framing of a required feature (e.g. "a red
  circle? hardly — only flat grey") now escalates to a challengeable
  `ambiguous_presence` signal instead of a terminal `affirmed_presence`. See
  `docs/FIDELITY-PROBE-FINDINGS.md`.
- Orchestrate fidelity adjudication over a completed cycle with role isolation
  (`runFidelityAdjudication`): the commitment is frozen from the locked
  intention, detection runs deterministically over the blind witness (never the
  maker's claims), the maker self-report and the adversarial reviewer are
  separate providers, and the run is resumable and idempotent. The offline
  provider returns an honest `undetectable` verdict because the witness makes no
  decodable visual claim.

## 0.1.0 - 2026-06-20

Initial standalone Haunted Studio research prototype.

- Established a fresh repository identity and history.
- Preserved prototype lineage in `docs/ORIGINS.md`.
- Kept the append-only ledger, state reconstruction, intention locking,
  revision, refusal, human review, forking, and six-condition experiment.
- Clarified that role modules run inside one orchestration process.
- Distinguished concept acceptance from artifact-audit passage and simulated
  audience prediction from consented human review.
- Added dependency-free source checks and broader CI validation.
- Hardened reset, mailbox, provider, privacy, and provenance documentation.

The earlier `0.2.0` and `0.3.0` labels were internal prototype milestones in a
different repository, not releases of this standalone project.
