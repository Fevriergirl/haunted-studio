// Studio art loop — a thin orchestration that runs ONE complete artist cycle for
// a seed idea and saves a viewable artifact bundle. It only composes existing
// engine functions; all provenance still flows through the ledger.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, writeJsonAtomic } from '../core/fs.js';
import { runCreativeCycle } from './creative-cycle.js';
import { StudioArtistProvider } from '../providers/artifact-provider.js';

const FILLER_TAGS = ['attention', 'absence', 'room', 'silence'];

export function makeSeedObservation(seed) {
  const text = String(seed ?? '').trim();
  if (!text) throw new Error('A seed idea is required.');
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const tags = [...new Set(words.filter((word) => word.length > 3))].slice(0, 5);
  while (tags.length < 2) tags.push(FILLER_TAGS[tags.length]);
  return {
    id: `seed-${createHash('sha256').update(text).digest('hex').slice(0, 12)}`,
    source: 'studio-operator',
    text,
    tags,
    rights: 'operator-provided'
  };
}

function artifactsDir(studio, cycleId) {
  return path.join(studio.rootDir, 'artifacts', 'cycles', cycleId);
}

async function saveArtifactBundle({ studio, seed, mode, extension, result }) {
  if (!result.selected || !result.artifactPath) return null;
  const cycleId = result.cycleId;
  const dir = artifactsDir(studio, cycleId);
  await ensureDir(dir);

  const artifactFile = path.join(dir, `artifact.${extension}`);
  await writeFile(artifactFile, await readFile(result.artifactPath));

  const events = await studio.ledger.readAll();
  const ledgerEventIds = events.filter((event) => event.cycle_id === cycleId).map((event) => event.event_id);
  const critique = result.critiques.find((item) => item.candidate_id === result.selected.id) ?? null;
  const reflection = {
    audit: result.artifactAudit ?? null,
    truth_read: critique?.truth_read ?? null,
    strongest_objection: critique?.strongest_objection ?? null,
    revision: critique?.revision ?? null
  };

  const metadata = {
    seed,
    cycle_id: cycleId,
    artist_brief: result.selected.artifact_brief,
    generated_prompt: result.selected.generation_prompt,
    provider: mode,
    artifact_path: path.relative(studio.rootDir, artifactFile),
    reflection,
    canon_decision: { decision: result.curation.decision, canon_status: result.canonStatus },
    ledger_event_ids: ledgerEventIds
  };
  await writeJsonAtomic(path.join(dir, 'metadata.json'), metadata);

  return { dir, artifactFile, metadata, artifactUrl: `/artifacts/cycles/${cycleId}/artifact.${extension}` };
}

export async function beginStudioCycle({ studio, seed, mode = 'mock', operationId = null }) {
  const provider = new StudioArtistProvider(mode);
  const observation = makeSeedObservation(seed);
  const result = await runCreativeCycle({
    studio, provider, observations: [observation], generateImage: true,
    features: { refusal: false }, operationId
  });
  const bundle = await saveArtifactBundle({ studio, seed, mode: provider.artifactMode, extension: provider.artifactExtension, result });
  return {
    cycle_id: result.cycleId,
    mode: provider.artifactMode,
    seed,
    accepted_by_curator: Boolean(result.selected),
    curator_decision: result.curation.decision,
    artist_brief: result.selected?.artifact_brief ?? null,
    generated_prompt: result.selected?.generation_prompt ?? null,
    reflection: bundle?.metadata.reflection ?? null,
    canon_status: result.canonStatus,
    artifact_url: bundle?.artifactUrl ?? null,
    metadata: bundle?.metadata ?? null,
    rationale: result.curation.rationale,
    state: result.state
  };
}
