#!/usr/bin/env node
import path from 'node:path';
import { loadProjectConfig } from './config.js';
import { Studio } from './core/studio.js';
import { createProvider } from './providers/index.js';
import { runCreativeCycle } from './engine/creative-cycle.js';
import { runFidelityAdjudication } from './engine/fidelity-cycle.js';
import { beginStudioCycle } from './engine/studio-cycle.js';
import { startStudioServer } from './studio/server.js';
import { recordHumanReview } from './engine/human-review.js';
import { writeTrajectoryReport } from './engine/report.js';
import { forkStudio } from './engine/fork.js';
import { runDoctor } from './engine/doctor.js';
import { JsonlMailbox } from './mailbox/mailbox.js';
import { startMailboxServer } from './mailbox/server.js';
import { EXPERIMENT_CONDITIONS } from './experiment/conditions.js';
import { runAblationExperiment } from './experiment/runner.js';
import { recordMemoryCorrection } from './engine/memory-correction.js';
import { recordMailboxConsumption } from './engine/mailbox-consumption.js';
import { abandonCycle } from './engine/recovery.js';
import { spawn } from 'node:child_process';

// Best-effort: open the studio page in the user's default browser so launching is
// a single step. Silently does nothing if no opener exists (e.g. a headless box)
// or if HAUNTED_STUDIO_NO_OPEN is set. Only ever opens a local loopback URL.
function openBrowser(url) {
  if (process.env.HAUNTED_STUDIO_NO_OPEN) return;
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(opener, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // ignore: just means we couldn't auto-open
    child.unref();
  } catch { /* ignore: launching still works, the user opens the URL manually */ }
}

function parseArguments(argv) {
  const [command = 'run', ...tokens] = argv.slice(2);
  const flags = new Set();
  const values = {};
  const positionals = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [rawName, inlineValue] = token.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      values[rawName] = inlineValue;
    } else if (tokens[index + 1] && !tokens[index + 1].startsWith('--')) {
      values[rawName] = tokens[index + 1];
      index += 1;
    } else {
      flags.add(rawName);
    }
  }

  return { command, flags, values, positionals };
}

function printCycle(result) {
  console.log(`\nCycle: ${result.cycleId}`);
  console.log(`Observation: ${result.attention.observation.text}`);
  console.log(`Necessity: ${result.necessity.statement}`);
  console.log(`Decision: ${result.curation.decision}`);
  console.log(`Score: ${result.curation.score}`);
  if (result.selected) console.log(`Canon candidate: ${result.selected.title}`);
  else console.log(`Refusal: ${result.curation.rationale}`);
  console.log(`Ledger: valid, ${result.verification.count} events`);
  console.log(`State: ${result.state.cycle_count} completed cycle(s), ${result.state.canon.length} canon work(s)`);
}

function mailboxObservations(messages) {
  return messages.map((message) => ({
    id: `mailbox-${message.message_id}`,
    source: message.sender ?? 'external',
    text: message.payload?.text,
    tags: Array.isArray(message.payload?.tags) ? message.payload.tags : [],
    rights: message.payload?.rights ?? 'external-unverified',
    mailbox_message_id: message.message_id
  })).filter((observation) => typeof observation.text === 'string' && observation.text.trim());
}

async function main() {
  const parsed = parseArguments(process.argv);
  const config = await loadProjectConfig();
  const studio = new Studio({ rootDir: config.studioRoot, constitution: config.constitution, experiment: config.experiment });

  if (parsed.command === 'run' && parsed.values.seed) {
    // One-shot studio art cycle from a seed idea (mock artifact by default).
    await studio.initialize();
    const mode = process.env.HAUNTED_STUDIO_ARTIFACT === 'image' ? 'image' : 'mock';
    const summary = await beginStudioCycle({
      studio, seed: parsed.values.seed, mode, operationId: parsed.values['operation-id'] ?? null
    });
    console.log(`\nSeed: ${summary.seed}`);
    console.log(`Mode: ${summary.mode.toUpperCase()} ${mode === 'mock' ? '(no API keys needed)' : ''}`);
    console.log(`Cycle: ${summary.cycle_id}`);
    console.log(`Curator decision: ${summary.curator_decision}`);
    if (summary.artifact_url) {
      console.log(`Artist brief: ${summary.artist_brief}`);
      console.log(`Image prompt: ${summary.generated_prompt}`);
      console.log(`Artifact saved: ${summary.metadata.artifact_path}`);
      console.log(`Metadata: artifacts/cycles/${summary.cycle_id}/metadata.json`);
    } else {
      console.log(`Refusal: ${summary.rationale}`);
    }
    const activeCanon = summary.state.canon.filter((work) => !work.revoked).length;
    console.log(`State: ${summary.state.cycle_count} cycle(s), ${activeCanon} active canon work(s)`);
    return;
  }

  if (parsed.command === 'run') {
    const provider = createProvider();
    const mailbox = new JsonlMailbox(path.join(config.studioRoot, 'mailbox.jsonl'));
    const mailboxLimit = Number(parsed.values.limit ?? 20);
    if (parsed.flags.has('mailbox') && (!Number.isInteger(mailboxLimit) || mailboxLimit < 1 || mailboxLimit > 100)) {
      throw new Error('--limit must be an integer from 1 to 100.');
    }
    const pending = parsed.flags.has('mailbox')
      ? await mailbox.poll({ type: 'observation_signal', limit: mailboxLimit })
      : [];
    const observations = [...config.observations, ...mailboxObservations(pending)];
    const conditionName = parsed.values.condition ?? (parsed.flags.has('ablate-memory') ? 'no_memory' : 'full');
    const condition = EXPERIMENT_CONDITIONS[conditionName];
    if (!condition) {
      throw new Error(`Unknown experiment condition: ${conditionName}. Expected one of: ${Object.keys(EXPERIMENT_CONDITIONS).join(', ')}.`);
    }
    const conditionFeatures = condition.features;
    const result = await runCreativeCycle({
      studio,
      provider,
      observations,
      generateImage: parsed.flags.has('image'),
      condition: conditionName,
      features: conditionFeatures,
      ablateMemory: parsed.flags.has('ablate-memory'),
      operationId: parsed.values['operation-id'] ?? null,
      resume: parsed.flags.has('resume')
    });
    if (pending.length) {
      await recordMailboxConsumption({
        studio,
        cycleId: result.cycleId,
        messageIds: pending.map((message) => message.message_id),
        operationId: parsed.values['mailbox-operation-id'] ?? `${result.operationId}:mailbox-consumption`
      });
      await mailbox.acknowledge(pending.map((message) => message.message_id));
      result.verification = await studio.ledger.verify();
    }
    printCycle(result);
    // Make fidelity adjudication real: independently audit the finished work.
    // Inert when there is no blind witness (conceptual cycles) or the provider
    // cannot adjudicate; bites only when concealment is confirmed.
    if (provider.supportsFidelityAdjudication === true) {
      const fidelity = await runFidelityAdjudication({ studio, cycleId: result.cycleId, provider });
      if (fidelity.status === 'available') {
        console.log(`Fidelity: ${fidelity.adjudication.status}` +
          (fidelity.canon_revoked ? ' — canon REVOKED (confirmed concealed deviation)' : ''));
      }
    }
    return;
  }

  if (parsed.command === 'status') {
    await studio.initialize();
    console.log(JSON.stringify(await studio.getState(), null, 2));
    return;
  }

  if (parsed.command === 'verify') {
    const result = await studio.ledger.verify();
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (parsed.command === 'experiment') {
    const cycles = Number(parsed.positionals[0] ?? 5);
    const outputRoot = path.resolve(parsed.positionals[1] ?? 'experiments/latest');
    const comparison = await runAblationExperiment({
      outputRoot,
      cyclesPerCondition: cycles,
      constitution: config.constitution,
      experiment: config.experiment,
      observations: config.observations,
      providerFactory: () => createProvider()
    });
    console.log(`Wrote six-condition comparison to ${outputRoot}`);
    for (const item of comparison.conditions) {
      console.log(`${item.name}: acceptance=${item.report.cycles.acceptance_rate}, attention_entropy=${item.report.attention.normalized_observation_entropy}`);
    }
    return;
  }

  if (parsed.command === 'report') {
    await studio.initialize();
    const outputDirectory = path.resolve(parsed.positionals[0] ?? path.join(config.studioRoot, 'reports'));
    const report = await writeTrajectoryReport({ studio, outputDirectory });
    console.log(`Wrote trajectory report to ${outputDirectory}`);
    console.log(JSON.stringify(report.cycles, null, 2));
    return;
  }

  if (parsed.command === 'review') {
    await studio.initialize();
    const [cycleId, reviewFile] = parsed.positionals;
    if (!cycleId || !reviewFile) throw new Error('Usage: node src/cli.js review <cycle-id> <review.json>');
    const result = await recordHumanReview({
      studio,
      cycleId,
      reviewFile: path.resolve(reviewFile),
      operationId: parsed.values['operation-id'] ?? null
    });
    console.log(`Recorded ${result.review.review_id} at ${result.reviewPath}`);
    return;
  }

  if (parsed.command === 'correct-memory') {
    await studio.initialize();
    const [correctionFile] = parsed.positionals;
    if (!correctionFile) throw new Error('Usage: node src/cli.js correct-memory <correction.json>');
    const event = await recordMemoryCorrection({
      studio,
      correctionFile: path.resolve(correctionFile),
      operationId: parsed.values['operation-id'] ?? null
    });
    console.log(`Appended correction event ${event.event_id}. Earlier history was not edited.`);
    return;
  }

  if (parsed.command === 'fork') {
    const [target, label = 'experimental fork'] = parsed.positionals;
    if (!target) throw new Error('Usage: node src/cli.js fork <target-state-directory> [label]');
    const result = await forkStudio({
      studio,
      targetRoot: path.resolve(target),
      label,
      operationId: parsed.values['operation-id'] ?? null
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (parsed.command === 'abandon') {
    await studio.initialize();
    const [operationId] = parsed.positionals;
    const cycleId = parsed.values['cycle-id'] ?? null;
    if (!operationId && !cycleId) throw new Error('Usage: node src/cli.js abandon <cycle-operation-id> [--cycle-id <legacy-cycle-id>] [--operation-id <abandonment-operation-id>]');
    const event = await abandonCycle({
      studio,
      operationId,
      cycleId,
      abandonmentOperationId: parsed.values['operation-id'] ?? null
    });
    console.log(`Abandoned incomplete cycle with terminal event ${event.event_id}.`);
    return;
  }

  if (parsed.command === 'doctor') {
    await studio.initialize();
    const providerName = process.env.HAUNTED_STUDIO_PROVIDER ?? 'deterministic';
    const result = await runDoctor({ cwd: process.cwd(), studio, providerName });
    for (const check of result.checks) {
      console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}${check.detail ? `: ${check.detail}` : ''}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (parsed.command === 'rebuild-state') {
    const state = await studio.rebuildStateFromLedger();
    console.log(`Rebuilt state projection from the append-only ledger. Cycles: ${state.cycle_count}`);
    return;
  }

  if (parsed.command === 'reset') {
    const archiveRoot = await studio.archive();
    if (archiveRoot) {
      console.log(`Archived studio state at ${archiveRoot}`);
    } else {
      console.log(`No studio state exists at ${config.studioRoot}`);
    }
    return;
  }

  if (parsed.command === 'serve') {
    await studio.initialize();
    const mailbox = new JsonlMailbox(path.join(config.studioRoot, 'mailbox.jsonl'));
    const port = Number(process.env.HAUNTED_STUDIO_PORT ?? 19820);
    const host = process.env.HAUNTED_STUDIO_HOST ?? '127.0.0.1';
    startMailboxServer({ mailbox, ledger: studio.ledger, port, host });
    console.log(`Haunted Studio observation mailbox listening on http://${host}:${port}`);
    return;
  }

  if (parsed.command === 'studio') {
    await studio.initialize();
    const mode = process.env.HAUNTED_STUDIO_ARTIFACT === 'image' ? 'image' : 'mock';
    const port = Number(process.env.HAUNTED_STUDIO_PORT ?? 19830);
    const host = process.env.HAUNTED_STUDIO_HOST ?? '127.0.0.1';
    startStudioServer({ studio, mode, port, host });
    const url = `http://${host}:${port}/studio`;
    console.log('\n  Haunted Studio is open.\n');
    console.log(`  Go to:  ${url}\n`);
    console.log(`  Mode:   ${mode === 'image' ? 'Real images (uses your image AI key)' : 'Practice (free, no key needed)'}`);
    console.log('  Stop:   press Ctrl-C in this window\n');
    openBrowser(url); // best-effort; harmless if no browser is available
    return;
  }

  throw new Error(`Unknown command: ${parsed.command}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
