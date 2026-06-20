# Changelog

## Unreleased

- Require blind post-result artifact evidence and adversarial review before a
  deviation can be classified as productive surprise.
- Treat legacy `proposed_accident` fields as planned ambiguity rather than
  discovered evidence.
- Preserve version-0 and pre-evidence version-1 ledger compatibility without
  rewriting history.

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
