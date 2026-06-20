import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical-json.js';
import { id } from '../core/ids.js';
import { InjectedCrashError, maybeInjectCrash } from '../core/crash-injection.js';
import { assertOperationCompatible, operationFingerprint, operationIdentity, serializeOperation } from '../core/operations.js';
import { projectLedger } from '../core/projection.js';
import { terminalEventForCycle } from '../core/event-contract.js';
import { chooseObservation } from '../roles/attention.js';
import { formAndLockIntention, makeCandidates } from '../roles/artist.js';
import { runCriticPanel } from '../roles/critics.js';
import { curate } from '../roles/curator.js';
import { consolidate } from '../roles/memory.js';
import { resolveFeatures } from '../experiment/conditions.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function curationResult(payload) {
  if (!payload) return payload;
  const { round: _round, ...result } = payload;
  return result;
}

function cycleResultFromEvents({ events, cycleId, operationId, state, verification, resumed = false }) {
  const cycleEvents = events.filter((event) => event.cycle_id === cycleId);
  const attention = cycleEvents.find((event) => event.type === 'observation_selected')?.payload;
  const lock = cycleEvents.find((event) => event.type === 'intention_locked')?.payload;
  let candidates = cycleEvents.find((event) => event.type === 'candidates_generated')?.payload?.candidates ?? [];
  let critiques = cycleEvents.find((event) => event.type === 'critics_reported')?.payload?.critiques ?? [];
  const revision = cycleEvents.find((event) => event.type === 'candidate_revised')?.payload;
  const revisionCritique = cycleEvents.find((event) => event.type === 'revision_critiqued')?.payload;
  if (revision) candidates = [...candidates.filter((item) => item.id !== revision.parent_candidate_id), revision.revised_candidate];
  if (revisionCritique) critiques = [...critiques.filter((item) => item.candidate_id !== revision?.parent_candidate_id), revisionCritique];
  const manifest = cycleEvents.find((event) => event.type === 'cycle_completed')?.payload;
  const curation = manifest?.curation ?? cycleEvents.findLast((event) =>
    ['curation_decided', 'curation_overridden_by_condition'].includes(event.type)
  )?.payload;
  const artifactAudit = cycleEvents.find((event) => event.type === 'artifact_audited')?.payload ?? null;
  const audiencePrediction = cycleEvents.find((event) => event.type === 'audience_predicted')?.payload ?? null;
  const memory = cycleEvents.find((event) => event.type === 'memory_consolidated')?.payload ?? null;
  return {
    operationId,
    resumed,
    cycleId,
    attention,
    necessity: lock?.necessity,
    intention: lock?.intention,
    intentionHash: lock?.intention_commitment ?? lock?.intention_hash,
    candidates,
    critiques,
    curation,
    selected: manifest?.selected_candidate ?? null,
    artifactPath: manifest?.artifact_path ?? null,
    artifactAudit,
    canonStatus: manifest?.canon_status ?? null,
    audiencePrediction,
    memory,
    state,
    verification
  };
}

export async function runCreativeCycle(options) {
  const resolvedOperationId = operationIdentity(options.operationId, 'cycle-operation');
  return serializeOperation(
    `creative-cycle:${options.studio.rootDir}:${resolvedOperationId}`,
    () => runCreativeCycleUnlocked({ ...options, operationId: resolvedOperationId })
  );
}

async function runCreativeCycleUnlocked({
  studio,
  provider,
  observations,
  generateImage = false,
  condition = 'haunted_studio',
  ablateMemory = false,
  features = {},
  cycleIdOverride = null,
  operationId = null,
  resume = false,
  crashAfter = null
}) {
  const state = await studio.initialize();
  const activeFeatures = resolveFeatures(features);
  const resolvedOperationId = operationId;
  const fingerprint = operationFingerprint({
    kind: 'creative_cycle',
    provider: provider.name,
    observations,
    generate_image: generateImage,
    condition,
    ablate_memory: ablateMemory,
    features: activeFeatures,
    experiment: studio.experiment,
    constitution: studio.constitution
  });
  let events = await studio.ledger.readAll();
  const operationEvents = assertOperationCompatible(events, resolvedOperationId, fingerprint);
  const started = operationEvents.find((event) => event.type === 'cycle_started');
  const unrelatedIncomplete = state.incomplete_cycles.filter((item) => item.operation_id !== resolvedOperationId);
  if (!started && unrelatedIncomplete.length) {
    throw new Error(`Cannot start a new operation while an incomplete cycle exists: ${unrelatedIncomplete.map((item) => item.operation_id ?? item.cycle_id).join(', ')}.`);
  }
  if (!started && resume) throw new Error(`Cannot resume unknown operation ${resolvedOperationId}.`);

  const cycleId = started?.cycle_id ?? cycleIdOverride ?? id('cycle');
  const cycleOwner = events.find((event) => event.type === 'cycle_started' && event.cycle_id === cycleId);
  if (cycleOwner && cycleOwner.payload?.operation_id !== resolvedOperationId) {
    throw new Error(`Cycle identity conflict for ${cycleId}: it belongs to another operation.`);
  }
  const existingTerminal = terminalEventForCycle(events, cycleId);
  if (existingTerminal?.type === 'cycle_completed') {
    const projected = await studio.projectAndSave('idempotent_cycle_retry');
    return cycleResultFromEvents({
      events: await studio.ledger.readAll(), cycleId, operationId: resolvedOperationId,
      state: projected, verification: await studio.ledger.verify(), resumed: true
    });
  }
  if (existingTerminal?.type === 'cycle_failed') {
    throw new Error(`Cycle operation ${resolvedOperationId} already failed and cannot be rerun.`);
  }
  if (started && !resume) throw new Error(`Operation ${resolvedOperationId} has an incomplete cycle; explicit resume is required.`);
  if (!started && state.cycle_count >= studio.experiment.budgets.maximum_cycles) throw new Error('Maximum cycle budget reached.');

  const baseState = started ? projectLedger(events.slice(0, events.indexOf(started))) : state;
  const memoryAblated = ablateMemory || !activeFeatures.autobiographicalMemory;
  const memoryView = memoryAblated
    ? { ...baseState, motifs: {}, observation_counts: {}, active_surprises: [], unresolved_tensions: [], audience_findings: [] }
    : baseState;
  const agentState = activeFeatures.surpriseCarryover ? memoryView : { ...memoryView, active_surprises: [] };
  const ablations = [
    ...(!activeFeatures.autobiographicalMemory ? ['autobiographical_memory'] : []),
    ...(!activeFeatures.selfDirectedAttention ? ['self_directed_attention'] : []),
    ...(!activeFeatures.refusal ? ['refusal'] : []),
    ...(!activeFeatures.revision ? ['revision'] : []),
    ...(!activeFeatures.audienceModel ? ['audience_model'] : []),
    ...(!activeFeatures.surpriseCarryover ? ['surprise_carryover'] : [])
  ];

  const cycleEvents = () => events.filter((event) => event.cycle_id === cycleId);
  const firstEvent = (type) => cycleEvents().find((event) => event.type === type);
  const append = async (spec, boundary = spec.type) => {
    const event = await studio.ledger.append({ ...spec, cycleId: spec.cycleId ?? cycleId });
    events.push(event);
    maybeInjectCrash(crashAfter, boundary);
    return event;
  };

  try {
    if (!started) {
      await append({
        type: 'cycle_started', actor: 'orchestrator',
        payload: {
          operation_id: resolvedOperationId,
          operation_fingerprint: fingerprint,
          provider: provider.name,
          prior_cycle_count: state.cycle_count,
          condition,
          features: activeFeatures,
          ablations,
          starting_ledger_head: baseState.ledger_head
        }
      });
    }

    let attention = firstEvent('observation_selected')?.payload;
    if (!attention) {
      attention = activeFeatures.selfDirectedAttention
        ? await chooseObservation({ provider, observations, state: agentState, constitution: studio.constitution })
        : {
            observation: observations[state.cycle_count % observations.length], score: null,
            reasons: ['Assigned by the experimental condition rather than selected by the attention agent.'], alternatives: []
          };
      await studio.writeCycleFile(cycleId, '01-observation.json', attention);
      await append({ type: 'observation_selected', actor: 'role:attention', payload: attention });
    }

    let lock = firstEvent('intention_locked')?.payload;
    if (!lock) {
      const formed = await formAndLockIntention({
        provider, observation: attention.observation, state: agentState, constitution: studio.constitution
      });
      const intentionContent = {
        observation_id: attention.observation.id,
        necessity: formed.necessity,
        intention: formed.intention
      };
      const intentionHash = sha256(canonicalize(intentionContent));
      lock = {
        cycle_id: cycleId,
        locked_at: new Date().toISOString(),
        ...intentionContent,
        intention_commitment: intentionHash,
        intention_hash: intentionHash
      };
      await studio.writeCycleFile(cycleId, '02-locked-intention.json', lock);
      await append({ type: 'intention_locked', actor: 'role:artist', payload: lock });
    }
    const { necessity, intention } = lock;
    const intentionHash = lock.intention_commitment ?? lock.intention_hash;

    let candidates = firstEvent('candidates_generated')?.payload?.candidates;
    if (!candidates) {
      candidates = await makeCandidates({
        provider, observation: attention.observation, necessity, intention, state: agentState,
        constitution: studio.constitution, experiment: studio.experiment, cycleId
      });
      await studio.writeCycleFile(cycleId, '03-candidates.json', candidates);
      await append({ type: 'candidates_generated', actor: 'role:artist', payload: { candidates } });
    }

    let critiques = firstEvent('critics_reported')?.payload?.critiques;
    if (!critiques) {
      critiques = await runCriticPanel({ provider, candidates, intention, state: agentState, constitution: studio.constitution });
      await studio.writeCycleFile(cycleId, '04-critiques.json', critiques);
      await append({ type: 'critics_reported', actor: 'role:critics', payload: { critiques } });
    }

    let workingCandidates = candidates;
    let workingCritiques = critiques;
    let curation = curationResult(cycleEvents().filter((event) => event.type === 'curation_decided')[0]?.payload);
    if (!curation) {
      curation = await curate({
        provider, candidates: workingCandidates, critiques: workingCritiques, intention, state: agentState,
        constitution: studio.constitution, experiment: studio.experiment,
        allowRevision: activeFeatures.revision && studio.experiment.budgets.maximum_revision_rounds > 0
      });
      await studio.writeCycleFile(cycleId, '05-curation.json', curation);
      await append({ type: 'curation_decided', actor: 'role:curator', payload: { round: 0, ...curation } });
    }

    const priorOverride = firstEvent('curation_overridden_by_condition');
    if (priorOverride) {
      curation = priorOverride.payload;
    } else if (!activeFeatures.refusal && curation.decision !== 'accept') {
      const originalDecision = curation.decision;
      const forcedCandidateId = curation.ranking?.[0]?.candidate_id ?? workingCandidates[0]?.id;
      curation = {
        ...curation,
        decision: 'accept',
        selected_candidate_id: forcedCandidateId,
        forced_by_condition: true,
        original_decision: originalDecision,
        rationale: `Forced acceptance condition overrode the curator. Original decision: ${originalDecision}. ${curation.rationale}`
      };
      await append({ type: 'curation_overridden_by_condition', actor: 'experiment-orchestrator', payload: curation }, 'curation_overridden_by_condition');
    }

    if (curation.decision === 'revise') {
      const original = workingCandidates.find((candidate) => candidate.id === curation.selected_candidate_id);
      const originalCritique = workingCritiques.find((critique) => critique.candidate_id === original.id);
      let revised = firstEvent('candidate_revised')?.payload?.revised_candidate;
      if (!revised) {
        revised = await provider.reviseCandidate({
          candidate: original, critique: originalCritique, intention, state: agentState,
          constitution: studio.constitution, cycleId
        });
        await studio.writeCycleFile(cycleId, '05a-revision.json', revised);
        await append({
          type: 'candidate_revised', actor: 'role:editor',
          payload: { parent_candidate_id: original.id, revised_candidate: revised }
        });
      }
      let revisedCritique = firstEvent('revision_critiqued')?.payload;
      if (!revisedCritique) {
        revisedCritique = await provider.critiqueCandidate({
          candidate: revised, intention, state: agentState, constitution: studio.constitution
        });
        await studio.writeCycleFile(cycleId, '05b-revision-critique.json', revisedCritique);
        await append({ type: 'revision_critiqued', actor: 'role:critics', payload: revisedCritique });
      }
      workingCandidates = [...workingCandidates.filter((candidate) => candidate.id !== original.id), revised];
      workingCritiques = [...workingCritiques.filter((critique) => critique.candidate_id !== original.id), revisedCritique];
      const finalCuration = curationResult(cycleEvents().filter((event) => event.type === 'curation_decided')[1]?.payload);
      if (finalCuration) {
        curation = finalCuration;
      } else {
        curation = await curate({
          provider, candidates: workingCandidates, critiques: workingCritiques, intention, state: agentState,
          constitution: studio.constitution, experiment: studio.experiment, allowRevision: false
        });
        await studio.writeCycleFile(cycleId, '05c-final-curation.json', curation);
        await append({ type: 'curation_decided', actor: 'role:curator', payload: { round: 1, ...curation } }, 'final_curation_decided');
      }
    }

    const selected = curation.decision === 'accept'
      ? workingCandidates.find((candidate) => candidate.id === curation.selected_candidate_id)
      : null;
    const selectedCritique = selected
      ? workingCritiques.find((critique) => critique.candidate_id === selected.id)
      : null;
    let artifactPath = firstEvent('artifact_generated')?.payload?.artifact_path ?? null;
    let artifactAudit = firstEvent('artifact_audited')?.payload ?? null;
    let canonStatus = selected ? 'conceptual_only' : null;
    if (selected && generateImage && provider.generateArtifact) {
      if (!artifactPath) {
        artifactPath = path.join(studio.cycleDirectory(cycleId), 'artifact.png');
        await provider.generateArtifact({ prompt: selected.generation_prompt, outputPath: artifactPath });
        await append({
          type: 'artifact_generated', actor: 'image-provider',
          payload: { candidate_id: selected.id, artifact_path: artifactPath }
        });
      }
      if (!artifactAudit) {
        artifactAudit = await provider.inspectArtifact({
          imagePath: artifactPath, candidate: selected, critique: selectedCritique, intention,
          constitution: studio.constitution, state: agentState
        });
        await studio.writeCycleFile(cycleId, '06-artifact-audit.json', artifactAudit);
        await append({ type: 'artifact_audited', actor: 'visual-critic', payload: artifactAudit });
      }
      canonStatus = artifactAudit.recommended_action === 'accept_artifact' &&
        Number(artifactAudit.overall_score) >= studio.experiment.artifact_audit_threshold
        ? 'artifact_audit_passed'
        : artifactAudit.recommended_action === 'reject_artifact'
          ? 'concept_accepted_artifact_rejected'
          : 'concept_accepted_artifact_needs_revision';
      if (canonStatus !== 'artifact_audit_passed' && !firstEvent('artifact_audit_not_passed')) {
        await append({
          type: 'artifact_audit_not_passed', actor: 'role:curator',
          payload: { candidate_id: selected.id, canon_status: canonStatus, threshold: studio.experiment.artifact_audit_threshold, audit: artifactAudit }
        });
      }
    }

    let audiencePrediction = firstEvent('audience_predicted')?.payload ?? null;
    if (selected && activeFeatures.audienceModel && !audiencePrediction) {
      audiencePrediction = await provider.predictAudience({
        selected, critique: selectedCritique, intention, artifactAudit, state: agentState
      });
      await studio.writeCycleFile(cycleId, '06b-audience-prediction.json', audiencePrediction);
      await append({ type: 'audience_predicted', actor: 'role:audience-prediction', payload: audiencePrediction });
    }

    let memory = firstEvent('memory_consolidated')?.payload;
    if (!memory) {
      memory = await consolidate({
        provider, observation: attention.observation, selection: selected, critiques: workingCritiques,
        curation, state: baseState, constitution: studio.constitution
      });
      if (!activeFeatures.surpriseCarryover) memory.active_surprises = [];
      await studio.writeCycleFile(cycleId, '07-memory-consolidation.json', memory);
      await append({ type: 'memory_consolidated', actor: 'role:memory', payload: memory });
    }

    const manifest = {
      cycle_id: cycleId,
      operation_id: resolvedOperationId,
      operation_fingerprint: fingerprint,
      provider: provider.name,
      condition,
      features: activeFeatures,
      ablations,
      observation: attention.observation,
      intention_hash: intentionHash,
      selected_candidate: selected,
      curation,
      audience_prediction: audiencePrediction,
      artifact_path: artifactPath,
      artifact_audit: artifactAudit,
      canon_status: canonStatus,
      constitution_version: studio.constitution.version,
      generated_at: new Date().toISOString()
    };
    await studio.writeCycleFile(cycleId, 'manifest.json', manifest);
    await append({ type: 'cycle_completed', actor: 'orchestrator', payload: manifest });
    const nextState = await studio.projectAndSave();
    maybeInjectCrash(crashAfter, 'state_saved');
    const verification = await studio.ledger.verify();
    return cycleResultFromEvents({
      events: await studio.ledger.readAll(), cycleId, operationId: resolvedOperationId,
      state: nextState, verification, resumed: Boolean(started)
    });
  } catch (error) {
    if (error instanceof InjectedCrashError) throw error;
    events = await studio.ledger.readAll();
    if (!terminalEventForCycle(events, cycleId)) {
      await studio.ledger.append({
        type: 'cycle_failed', actor: 'orchestrator', cycleId,
        payload: {
          name: error.name,
          message: error.message,
          operation_id: resolvedOperationId,
          operation_fingerprint: fingerprint
        }
      });
      await studio.projectAndSave();
    }
    throw error;
  }
}
