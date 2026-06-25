# Changelog

## Unreleased

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
