import path from 'node:path';
import { writeJsonAtomic } from '../core/fs.js';

function average(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  return numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null;
}

function round(value) {
  return value === null ? null : Math.round(value * 1000) / 1000;
}

function entropy(counts) {
  const values = Object.values(counts).filter((value) => value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total || values.length <= 1) return 0;
  const raw = -values.reduce((sum, value) => {
    const p = value / total;
    return sum + p * Math.log2(p);
  }, 0);
  return raw / Math.log2(values.length);
}

export async function buildTrajectoryReport({ studio }) {
  const state = await studio.getState();
  const events = await studio.ledger.readAll();
  const verification = await studio.ledger.verify();
  const completed = events.filter((event) => event.type === 'cycle_completed');
  const failed = events.filter((event) => event.type === 'cycle_failed');
  const revisions = events.filter((event) => event.type === 'candidate_revised');
  const reviews = events.filter((event) => event.type === 'human_review_recorded').map((event) => event.payload);
  const corrections = events.filter((event) => event.type === 'memory_corrected');

  const decisions = completed.map((event) => event.payload?.curation?.decision).filter(Boolean);
  const accepted = decisions.filter((decision) => decision === 'accept').length;
  const rejected = decisions.filter((decision) => decision === 'reject_all').length;
  const observationCounts = state.observation_counts ?? {};
  const motifCounts = state.motifs ?? {};
  const recurringMotifs = Object.entries(motifCounts).filter(([, count]) => count >= 2);
  const singleUseMotifs = Object.entries(motifCounts).filter(([, count]) => count === 1);

  const ratings = {
    necessity: round(average(reviews.map((review) => review.ratings?.necessity))),
    depth: round(average(reviews.map((review) => review.ratings?.depth))),
    decorative_risk: round(average(reviews.map((review) => review.ratings?.decorative_risk))),
    return_desire: round(average(reviews.map((review) => review.ratings?.return_desire)))
  };

  const canonStatuses = (state.canon ?? []).reduce((counts, item) => {
    const status = item.canon_status ?? 'legacy_unspecified';
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});

  const report = {
    generated_at: new Date().toISOString(),
    ledger: verification,
    cycles: {
      completed: completed.length,
      failed: failed.length,
      accepted,
      rejected,
      acceptance_rate: completed.length ? round(accepted / completed.length) : 0,
      revisions: revisions.length
    },
    attention: {
      observation_counts: observationCounts,
      normalized_observation_entropy: round(entropy(observationCounts)),
      most_selected: Object.entries(observationCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
    },
    trajectory: {
      canon_size: state.canon?.length ?? 0,
      canon_statuses: canonStatuses,
      artifact_audit_passed_count: canonStatuses.artifact_audit_passed ?? 0,
      conceptual_only_count: canonStatuses.conceptual_only ?? 0,
      motif_count: Object.keys(motifCounts).length,
      recurring_motif_count: recurringMotifs.length,
      single_use_motif_count: singleUseMotifs.length,
      normalized_motif_entropy: round(entropy(motifCounts)),
      unresolved_tension_count: state.unresolved_tensions?.length ?? 0,
      active_surprise_count: state.active_surprises?.length ?? 0,
      correction_count: corrections.length,
      repetition_risk: recurringMotifs.length > 0 && recurringMotifs.length / Math.max(1, Object.keys(motifCounts).length) > 0.7
        ? 'high'
        : 'not-yet-high'
    },
    audience: {
      review_count: reviews.length,
      average_ratings: ratings,
      prediction_findings: state.audience_findings ?? []
    },
    canon: state.canon ?? [],
    unresolved_tensions: state.unresolved_tensions ?? [],
    active_surprises: state.active_surprises ?? []
  };

  return report;
}

export function renderTrajectoryMarkdown(report) {
  const topObservations = report.attention.most_selected.length
    ? report.attention.most_selected.map(([id, count]) => `- ${id}: ${count}`).join('\n')
    : '- None yet';
  const tensions = report.unresolved_tensions.length
    ? report.unresolved_tensions.map((item) => `- ${item}`).join('\n')
    : '- None yet';
  const canon = report.canon.length
    ? report.canon.map((item) => `- ${item.title} (${item.score})`).join('\n')
    : '- No canonical works yet';

  return `# Haunted Studio trajectory report

Generated: ${report.generated_at}

## Integrity

- Ledger valid: ${report.ledger.valid}
- Ledger events: ${report.ledger.count}
- Ledger head: \`${report.ledger.head}\`

## Cycles

- Completed: ${report.cycles.completed}
- Failed: ${report.cycles.failed}
- Accepted: ${report.cycles.accepted}
- Rejected: ${report.cycles.rejected}
- Revisions: ${report.cycles.revisions}
- Acceptance rate: ${report.cycles.acceptance_rate}

## Attention

- Normalized observation entropy: ${report.attention.normalized_observation_entropy}
- Higher entropy means attention is distributed. Lower entropy may indicate fixation or collapse.

${topObservations}

## Developing trajectory

- Canon size: ${report.trajectory.canon_size}
- Artifacts passing internal audit: ${report.trajectory.artifact_audit_passed_count}
- Conceptual-only works: ${report.trajectory.conceptual_only_count}
- Known motifs: ${report.trajectory.motif_count}
- Recurring motifs: ${report.trajectory.recurring_motif_count}
- Active surprises: ${report.trajectory.active_surprise_count}
- Unresolved tensions: ${report.trajectory.unresolved_tension_count}
- Repetition risk: ${report.trajectory.repetition_risk}

### Canon

${canon}

### Unresolved tensions

${tensions}

## Audience evidence

- Human reviews: ${report.audience.review_count}
- Average necessity: ${report.audience.average_ratings.necessity ?? 'n/a'}
- Average depth: ${report.audience.average_ratings.depth ?? 'n/a'}
- Average decorative risk: ${report.audience.average_ratings.decorative_risk ?? 'n/a'}
- Average desire to return: ${report.audience.average_ratings.return_desire ?? 'n/a'}

## Interpretation warning

These measurements describe system behavior. They do not establish consciousness, feeling, inspiration, suffering, or personhood.
`;
}

export async function writeTrajectoryReport({ studio, outputDirectory }) {
  const report = await buildTrajectoryReport({ studio });
  await writeJsonAtomic(path.join(outputDirectory, 'trajectory-report.json'), report);
  const { ensureDir } = await import('../core/fs.js');
  const { writeFile } = await import('node:fs/promises');
  await ensureDir(outputDirectory);
  await writeFile(path.join(outputDirectory, 'trajectory-report.md'), renderTrajectoryMarkdown(report), 'utf8');
  return report;
}
