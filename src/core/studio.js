import path from 'node:path';
import { access, rename, rm } from 'node:fs/promises';
import { AppendOnlyLedger } from './ledger.js';
import { canonicalize } from './canonical-json.js';
import { ensureDir, readJson, writeJsonAtomic } from './fs.js';
import { id } from './ids.js';
import { INITIAL_STATE, projectLedger } from './projection.js';

export const DEFAULT_STATE = INITIAL_STATE;

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function sameHead(left, right) {
  return left?.sequence === right.sequence &&
    left?.event_id === right.event_id &&
    left?.event_hash === right.event_hash &&
    (left?.schema_version ?? 0) === right.schema_version;
}

export class Studio {
  constructor({ rootDir, constitution, experiment }) {
    this.rootDir = rootDir;
    this.constitution = constitution;
    this.experiment = experiment;
    this.statePath = path.join(rootDir, 'state.json');
    this.ledger = new AppendOnlyLedger(path.join(rootDir, 'ledger.jsonl'));
    this.worksDir = path.join(rootDir, 'works');
    this.lastProjectionStatus = null;
  }

  async verifiedEvents() {
    const verification = await this.ledger.verify();
    if (!verification.valid) throw new Error(`Ledger integrity failure: ${verification.error}`);
    return this.ledger.readAll();
  }

  async initialize() {
    await ensureDir(this.rootDir);
    await ensureDir(this.worksDir);
    let events = await this.ledger.readAll();
    if (events.length === 0) {
      if (await exists(this.statePath)) {
        const orphanedState = await readJson(this.statePath);
        const claimsHistory = (orphanedState.ledger_head?.sequence ?? 0) > 0 ||
          (orphanedState.cycle_count ?? 0) > 0 ||
          (orphanedState.canon?.length ?? 0) > 0 ||
          (orphanedState.rejected?.length ?? 0) > 0;
        if (claimsHistory) {
          throw new Error('Projected state is ahead of ledger: the ledger is empty but state claims history.');
        }
      }
      await this.ledger.append({
        type: 'studio_initialized',
        actor: 'system',
        payload: {
          constitution_version: this.constitution.version,
          experiment_name: this.experiment.experiment_name
        }
      });
    }
    events = await this.verifiedEvents();
    const expected = projectLedger(events);
    if (!(await exists(this.statePath))) return this.saveProjection(expected, 'missing_state_rebuilt');

    const state = await readJson(this.statePath);
    if (!state.ledger_head) return this.saveProjection(expected, 'legacy_state_rebuilt');
    if (state.ledger_head.sequence > expected.ledger_head.sequence) {
      throw new Error(`Projected state is ahead of ledger: state=${state.ledger_head.sequence}, ledger=${expected.ledger_head.sequence}.`);
    }
    if (state.ledger_head.sequence < expected.ledger_head.sequence) {
      const claimed = state.ledger_head.sequence === 0 ? INITIAL_STATE.ledger_head : {
        sequence: events[state.ledger_head.sequence - 1]?.sequence,
        event_id: events[state.ledger_head.sequence - 1]?.event_id,
        event_hash: events[state.ledger_head.sequence - 1]?.hash,
        schema_version: events[state.ledger_head.sequence - 1]?.schema_version ?? 0
      };
      if (!sameHead(state.ledger_head, claimed)) throw new Error('Projected state has a divergent ledger-head identity.');
      return this.saveProjection(expected, 'stale_state_rebuilt');
    }
    if (!sameHead(state.ledger_head, expected.ledger_head)) {
      throw new Error('Projected state has a divergent ledger-head identity.');
    }
    if (canonicalize(state) !== canonicalize(expected)) {
      return this.saveProjection(expected, 'content_mismatch_rebuilt');
    }
    this.lastProjectionStatus = { action: 'matched', ledger_head: expected.ledger_head };
    return state;
  }

  async getState() {
    return readJson(this.statePath, structuredClone(INITIAL_STATE));
  }

  async saveState(state) {
    await writeJsonAtomic(this.statePath, state);
  }

  async saveProjection(state, action = 'projected') {
    await this.saveState(state);
    this.lastProjectionStatus = { action, ledger_head: state.ledger_head };
    return state;
  }

  async projectAndSave(action = 'live_projection') {
    const events = await this.verifiedEvents();
    return this.saveProjection(projectLedger(events), action);
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
    const events = await this.verifiedEvents();
    return this.saveProjection(projectLedger(events), 'explicit_rebuild');
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
