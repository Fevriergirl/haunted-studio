# Repository guidance

## Purpose

Haunted Studio is a research prototype that tests whether persistent history,
criticism, refusal, audience interpretation, and unresolved tensions can alter
later creative outputs in measurable ways.

The modules under `src/roles/` are role boundaries inside one orchestration
process. They are not independent network services or evidence of independent
agency.

## Non-negotiable rules

1. Never claim consciousness, emotion, inspiration, suffering, personhood, or
   demonstrated artistic development.
2. Preserve the append-only ledger. Corrections are new events; old events are
   not rewritten.
3. Lock intention before candidate generation.
4. Keep generation, criticism, curation, audience prediction, and memory
   consolidation as separable roles.
5. Rejection is valid; do not force acceptance outside its explicit ablation.
6. Distinguish concept acceptance, artifact-audit results, simulated audience
   prediction, and consented human review.
7. Keep deterministic operation offline and free of paid-service requirements.
8. Do not log, commit, or publish credentials or unreviewed runtime data.
9. Document changes to thresholds, weights, constitution rules, or conditions.
10. Prefer Node.js standard-library code unless a dependency solves a measured
    need.

## Definition of done

- `npm ci` succeeds.
- `npm run validate` succeeds.
- `npm run demo` succeeds with a valid ledger.
- `npm run experiment:smoke` succeeds.
- `npm run doctor` and `npm run verify` succeed after a cycle.
- Documentation changes with behavior.
