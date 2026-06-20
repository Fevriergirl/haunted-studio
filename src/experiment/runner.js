import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { Studio } from '../core/studio.js';
import { runCreativeCycle } from '../engine/creative-cycle.js';
import { buildTrajectoryReport, writeTrajectoryReport } from '../engine/report.js';
import { EXPERIMENT_CONDITIONS } from './conditions.js';

function markdownComparison(comparison) {
  const lines = [
    '# Haunted Studio ablation comparison',
    '',
    `Generated: ${comparison.generated_at}`,
    '',
    `Cycles per condition: ${comparison.cycles_per_condition}`,
    '',
    '| Condition | Acceptance | Observation entropy | Recurring motifs | Active surprises | Reviews |',
    '|---|---:|---:|---:|---:|---:|'
  ];
  for (const result of comparison.conditions) {
    lines.push(`| ${result.label} | ${result.report.cycles.acceptance_rate} | ${result.report.attention.normalized_observation_entropy} | ${result.report.trajectory.recurring_motif_count} | ${result.report.trajectory.active_surprise_count} | ${result.report.audience.review_count} |`);
  }
  lines.push('', '## Interpretation', '', 'Differences between conditions are behavioral evidence, not evidence of consciousness. A small deterministic run validates the experiment machinery, not the artistic hypothesis. Use a live model, blinded human review, and enough cycles before drawing conclusions.', '');
  return lines.join('\n');
}

export async function runAblationExperiment({
  outputRoot,
  cyclesPerCondition,
  constitution,
  experiment,
  observations,
  providerFactory
}) {
  if (!Number.isInteger(cyclesPerCondition) || cyclesPerCondition < 1) {
    throw new Error('cyclesPerCondition must be a positive integer.');
  }
  await mkdir(outputRoot, { recursive: true });
  const results = [];

  for (const [conditionName, condition] of Object.entries(EXPERIMENT_CONDITIONS)) {
    const conditionRoot = path.join(outputRoot, conditionName, 'state');
    const studio = new Studio({ rootDir: conditionRoot, constitution, experiment });
    await studio.reset();
    const provider = providerFactory();

    for (let index = 0; index < cyclesPerCondition; index += 1) {
      await runCreativeCycle({
        studio,
        provider,
        observations,
        condition: conditionName,
        features: condition.features,
        cycleIdOverride: `cycle_${String(index + 1).padStart(3, '0')}`
      });
    }

    const reportDirectory = path.join(outputRoot, conditionName, 'report');
    await writeTrajectoryReport({ studio, outputDirectory: reportDirectory });
    results.push({
      name: conditionName,
      label: condition.label,
      features: condition.features,
      report: await buildTrajectoryReport({ studio })
    });
  }

  const comparison = {
    generated_at: new Date().toISOString(),
    cycles_per_condition: cyclesPerCondition,
    conditions: results
  };
  await writeFile(path.join(outputRoot, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
  await writeFile(path.join(outputRoot, 'comparison.md'), markdownComparison(comparison), 'utf8');
  return comparison;
}
