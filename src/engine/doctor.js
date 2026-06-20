import { access } from 'node:fs/promises';
import path from 'node:path';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor({ cwd, studio, providerName, environment = process.env }) {
  const major = Number(process.versions.node.split('.')[0]);
  const ledgerResult = await studio.ledger.verify();
  const events = await studio.ledger.readAll();
  const completedCycles = events.filter((event) => event.type === 'cycle_completed').length;
  const state = await studio.getState();
  const projectionMatches = state.cycle_count === completedCycles;
  const checks = [
    { name: 'Node.js 20 or newer', ok: major >= 20, detail: process.version },
    { name: 'Artistic constitution', ok: await exists(path.join(cwd, 'config', 'constitution.json')) },
    { name: 'Experiment config', ok: await exists(path.join(cwd, 'config', 'experiment.json')) },
    { name: 'Observation stream', ok: await exists(path.join(cwd, 'observations', 'seed-observations.json')) },
    {
      name: 'Provider configured',
      ok: providerName === 'deterministic' || (providerName === 'openai' && Boolean(environment.OPENAI_API_KEY)),
      detail: providerName
    },
    { name: 'Ledger integrity', ok: ledgerResult.valid, detail: ledgerResult.valid ? `${ledgerResult.count} events` : ledgerResult.error },
    { name: 'State projection matches ledger', ok: projectionMatches, detail: `state=${state.cycle_count}, ledger=${completedCycles}` }
  ];
  return { ok: checks.every((check) => check.ok), checks };
}
