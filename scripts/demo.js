import path from 'node:path';
import { loadProjectConfig } from '../src/config.js';
import { Studio } from '../src/core/studio.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { writeTrajectoryReport } from '../src/engine/report.js';

const config = await loadProjectConfig();
const demoRoot = path.join(process.cwd(), '.haunted-studio-demo');
const studio = new Studio({ rootDir: demoRoot, constitution: config.constitution, experiment: config.experiment });
await studio.reset();
const provider = new DeterministicProvider();

for (let index = 0; index < 5; index += 1) {
  const result = await runCreativeCycle({
    studio,
    provider,
    observations: config.observations,
    condition: 'haunted_studio_demo'
  });
  console.log(`${index + 1}/5 ${result.curation.decision} ${result.curation.score} ${result.attention.observation.id}`);
}

const outputDirectory = path.join(demoRoot, 'reports');
const report = await writeTrajectoryReport({ studio, outputDirectory });
console.log(`\nDemo complete. Report: ${path.join(outputDirectory, 'trajectory-report.md')}`);
console.log(`Ledger valid: ${report.ledger.valid}`);
