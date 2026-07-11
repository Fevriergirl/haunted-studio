# Changelog

## Unreleased

- Ready for iOS. Safari ignores SVG manifest icons, so the studio now ships
  full-bleed 180px and 512px PNG icons (rendered from the SVG, committed as
  assets) with an `apple-touch-icon` link and the iOS standalone meta tags —
  "Add to Home Screen" on an iPhone now installs a proper dark, named app.
  The viewport opts into `viewport-fit=cover` with `env(safe-area-inset-*)`
  padding so standalone mode clears the notch and home indicator, and
  unbroken strings (content hashes, artifact ids, file paths) wrap on narrow
  screens instead of widening the page.

- Six quick wins from a plain-user audit of the studio app: it is now
  installable as an app (web app manifest + on-theme SVG icon served by the
  studio server, so "Add to Home Screen" works on the deployed site); the
  same icon is the favicon, ending the 404 logged on every page load;
  Ctrl/Cmd+Enter in the idea box makes the art; the live status announces
  politely to screen readers, the cast lights carry labels/tooltips, and the
  result image gets meaningful alt text; the "incomplete cycle" error is
  explained in plain words with the fix; and the live story gently follows
  its own newest step — only when the viewer is already watching it.

- Show the program working live. The append-only ledger now accepts read-only
  subscribers (`ledger.subscribe(listener)`), notified with each event exactly
  as persisted — never on idempotent replays, and a throwing listener cannot
  break an append. The studio server streams those appends over a new
  `GET /api/live` Server-Sent-Events endpoint (persisted ledger events relayed
  verbatim; same host/auth/redaction posture as the other routes), and the
  studio page gains a "Watch it work" panel that fills in role by role — with a
  one-line payload peek per step — while a cycle runs, including cycles started
  from the terminal. `node src/cli.js run` prints the same live record line by
  line as steps are persisted (`HAUNTED_STUDIO_QUIET=1` suppresses it).
- Make the live view tell the story vividly. A "cast" strip renders every role
  as a stage light that comes on the moment that role works (pulsing while
  active), each role gets its own color, and every step now quotes the role's
  actual recorded words — the artist's stated necessity, the critics' strongest
  objection, the curator's rationale, the audience model's predicted
  misreading, the memory role's lesson — pulled straight from the event
  payloads, never invented in the UI.
- Pace and plain-speak the live story. Reveals are queued one per beat
  (~0.4 s, presentation only — recorded timestamps are untouched and slow
  real-image cycles are unaffected) so an instant deterministic cycle unfolds
  legibly instead of landing as one dump; cast lights ignite with a brief
  bloom; the finished piece is held until the story finishes; and
  `prefers-reduced-motion` disables the pacing and animation. Jargon is
  replaced with plain words: "Blind witness", "Plan checker", "Skeptic",
  "Studio rules" instead of role slugs, decisions render as words
  ("accepted", "rejected all", "sent back for revision") instead of raw
  values, and the curator's line follows its actual decision.
- Add ways to open the studio without the terminal: double-click launchers
  (`Open Haunted Studio.command` for macOS/Linux, `Open Haunted Studio.bat` for
  Windows) that start it and open the browser, and document the bookmarkable
  local link `http://localhost:19830/studio`. The launchers do a one-time
  `npm install` if needed and are otherwise a single click.
- Rewrite the studio interface in plain language so anyone can understand and
  use it, and make launching one step. The page is now a single guided path —
  type an idea, choose Practice (free, no key) or Real image, press "Make art",
  see the piece, and "Keep it / Discard it / Not sure". The technical vocabulary
  (intention, witness, canon, ledger, hashes) is replaced with everyday wording;
  "How this was made" tells the story in friendly sentences, with the full
  verified record kept behind a "Show the full record" toggle for the curious.
  `npm run studio` now prints a clear banner and opens the page in the browser
  automatically (set `HAUNTED_STUDIO_NO_OPEN=1` to disable; it only ever opens
  the local loopback URL).
- Make the studio interface show the whole process that makes this project
  special, not just the finished artifact. A new "auditable process" panel
  renders the role-separated trail behind each work — attention, artist, critics,
  curator, the *blind* witness, the deviation comparator, and the adversarial
  surprise reviewer — straight from the append-only ledger, with the frozen
  intention commitment, the human decision, and any marked-not-erased canon
  revocation called out. A badge verifies the hash chain (`✓ ledger verified · N
  events · head …`) so the auditability is visible, not just asserted. Backed by
  a thin `GET /api/cycle/:id/provenance` endpoint (the ledger as recorded, no new
  logic) and refreshed after each cycle and decision.
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
