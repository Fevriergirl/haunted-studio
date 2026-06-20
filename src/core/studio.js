import path from 'node:path';
import { access, rename, rm } from 'node:fs/promises';
import { AppendOnlyLedger } from './ledger.js';
import { ensureDir, readJson, writeJsonAtomic } from './fs.js';
import { id } from './ids.js';

export const DEFAULT_STATE = {
  version: 1,
  cycle_count: 0,
  canon: [],
  rejected: [],
  motifs: {},
  observation_counts: {},
  active_surprises: [],
  unresolved_tensions: [],
  audience_findings: [],
  last_cycle_id: null
};

export class Studio {
  constructor({ rootDir, constitution, experiment }) {
    this.rootDir = rootDir;
    this.constitution = constitution;
    this.experiment = experiment;
    this.statePath = path.join(rootDir, 'state.json');
    this.ledger = new AppendOnlyLedger(path.join(rootDir, 'ledger.jsonl'));
    this.worksDir = path.join(rootDir, 'works');
  }

  async initialize() {
    await ensureDir(this.rootDir);
    await ensureDir(this.worksDir);
    const state = await this.getState();
    if ((await this.ledger.readAll()).length === 0) {
      await this.ledger.append({
        type: 'studio_initialized',
        actor: 'system',
        payload: {
          constitution_version: this.constitution.version,
          experiment_name: this.experiment.experiment_name
        }
      });
      await this.saveState(state);
    }
    return state;
  }

  async getState() {
    return readJson(this.statePath, structuredClone(DEFAULT_STATE));
  }

  async saveState(state) {
    await writeJsonAtomic(this.statePath, state);
  }

  cycleDirectory(cycleId) {
    return path.join(this.worksDir, cycleId);
  }

  async writeCycleFile(cycleId, name, value) {
    const filePath = path.join(this.cycleDirectory(cycleId), name);
    await writeJsonAtomic(filePath, value);
    return filePath;
  }


  async rebuildStateFromLedger() {
    const events = await this.ledger.readAll();
    const state = structuredClone(DEFAULT_STATE);
    for (const event of events) {
      if (event.type === 'memory_consolidated') {
        state.motifs = event.payload.motifs ?? state.motifs;
        state.observation_counts = event.payload.observation_counts ?? state.observation_counts;
        state.active_surprises = event.payload.active_surprises ?? state.active_surprises;
        state.unresolved_tensions = event.payload.unresolved_tensions ?? state.unresolved_tensions;
      }

      if (event.type === 'cycle_completed') {
        const manifest = event.payload;
        state.cycle_count += 1;
        state.last_cycle_id = manifest.cycle_id;
        state.last_condition = manifest.condition ?? null;
        if (manifest.selected_candidate) {
          state.canon.push({
            cycle_id: manifest.cycle_id,
            candidate_id: manifest.selected_candidate.id,
            title: manifest.selected_candidate.title,
            score: manifest.curation?.score ?? null,
            intention_hash: manifest.intention_hash,
            artifact_path: manifest.artifact_path ?? null,
            canon_status: manifest.canon_status ?? 'legacy_unspecified',
            artifact_audit_score: manifest.artifact_audit?.overall_score ?? null
          });
        } else {
          state.rejected.push({
            cycle_id: manifest.cycle_id,
            rationale: manifest.curation?.rationale ?? 'No accepted candidate.',
            best_score: manifest.curation?.score ?? null
          });
        }
      }

      if (event.type === 'human_review_recorded') {
        state.audience_findings.push({
          review_id: event.payload.review_id,
          cycle_id: event.payload.cycle_id,
          actual_first_notice: event.payload.answers?.first_notice ?? null,
          too_explained: event.payload.answers?.too_explained ?? null,
          ratings: event.payload.ratings ?? null
        });
      }

      if (event.type === 'memory_corrected') {
        state.corrections = [...(state.corrections ?? []), {
          correction_event_id: event.event_id,
          ...event.payload
        }];
      }

      if (event.type === 'studio_forked') {
        state.branch = event.payload;
      }
    }

    await this.saveState(state);
    return state;
  }

  async reset() {
    await rm(this.rootDir, { recursive: true, force: true });
  }

  async archive() {
    try {
      await access(this.rootDir);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveRoot = `${this.rootDir}.archive-${timestamp}-${id('snapshot')}`;
    await rename(this.rootDir, archiveRoot);
    return archiveRoot;
  }
}
