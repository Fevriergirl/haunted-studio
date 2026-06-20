import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Studio } from '../src/core/studio.js';
import { DeterministicProvider } from '../src/providers/deterministic-provider.js';
import { runCreativeCycle } from '../src/engine/creative-cycle.js';
import { readJson } from '../src/core/fs.js';

const cwd = process.cwd();
const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));

class AuditedArtifactProvider extends DeterministicProvider {
  async generateArtifact({ outputPath }) {
    await writeFile(outputPath, Buffer.from('test-image'));
    return outputPath;
  }

  async inspectArtifact({ candidate }) {
    return {
      status: 'generated',
      candidate_id: candidate.id,
      overall_score: 0.9,
      recommended_action: 'accept_artifact',
      scores: {},
      observations: ['Test fixture only.'],
      failures: [],
      strongest_accident: null
    };
  }
}

test('concept acceptance and artifact-audit passage remain distinct', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'haunted-artifact-status-'));
  const studio = new Studio({ rootDir, constitution, experiment });
  const result = await runCreativeCycle({
    studio,
    provider: new AuditedArtifactProvider(),
    observations,
    generateImage: true
  });

  assert.ok(result.selected);
  assert.equal(result.canonStatus, 'artifact_audit_passed');
  assert.ok(result.artifactPath);
  const events = await studio.ledger.readAll();
  assert.ok(events.some((event) => event.type === 'artifact_generated'));
  assert.ok(events.some((event) => event.type === 'artifact_audited'));
});
