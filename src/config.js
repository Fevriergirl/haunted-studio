import path from 'node:path';
import { readJson } from './core/fs.js';

export async function loadProjectConfig(cwd = process.cwd(), environment = process.env) {
  const constitution = await readJson(path.join(cwd, 'config', 'constitution.json'));
  const experiment = await readJson(path.join(cwd, 'config', 'experiment.json'));
  const observations = await readJson(path.join(cwd, 'observations', 'seed-observations.json'));
  const studioRoot = path.resolve(cwd, environment.HAUNTED_STUDIO_HOME ?? '.haunted-studio');
  return { constitution, experiment, observations, studioRoot };
}
