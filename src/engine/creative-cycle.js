import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical-json.js';
import { id } from '../core/ids.js';
import { chooseObservation } from '../roles/attention.js';
import { formAndLockIntention, makeCandidates } from '../roles/artist.js';
import { runCriticPanel } from '../roles/critics.js';
import { curate } from '../roles/curator.js';
import { consolidate } from '../roles/memory.js';
import { resolveFeatures } from '../experiment/conditions.js';
import { terminalEventForCycle } from '../core/event-contract.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function runCreativeCycle({
  studio,
  provider,
  observations,
  generateImage = false,
  condition = 'haunted_studio',
  ablateMemory = false,
  features = {},
  cycleIdOverride = null
}) {
  const state = await studio.initialize();
  const activeFeatures = resolveFeatures(features);
  const memoryAblated = ablateMemory || !activeFeatures.autobiographicalMemory;
  const memoryView = memoryAblated
    ? {
        ...state,
        motifs: {},
        observation_counts: {},
        active_surprises: [],
        unresolved_tensions: [],
        audience_findings: []
      }
    : state;
  const agentState = activeFeatures.surpriseCarryover
    ? memoryView
    : { ...memoryView, active_surprises: [] };
  const ablations = [
    ...(!activeFeatures.autobiographicalMemory ? ['autobiographical_memory'] : []),
    ...(!activeFeatures.selfDirectedAttention ? ['self_directed_attention'] : []),
    ...(!activeFeatures.refusal ? ['refusal'] : []),
    ...(!activeFeatures.revision ? ['revision'] : []),
    ...(!activeFeatures.audienceModel ? ['audience_model'] : []),
    ...(!activeFeatures.surpriseCarryover ? ['surprise_carryover'] : [])
  ];
  if (state.cycle_count >= studio.experiment.budgets.maximum_cycles) {
    throw new Error('Maximum cycle budget reached.');
  }

  const cycleId = cycleIdOverride ?? id('cycle');
  await studio.ledger.append({
    type: 'cycle_started',
    actor: 'orchestrator',
    cycleId,
    payload: { provider: provider.name, prior_cycle_count: state.cycle_count, condition, features: activeFeatures, ablations }
  });

  try {
    const attention = activeFeatures.selfDirectedAttention
      ? await chooseObservation({
          provider,
          observations,
          state: agentState,
          constitution: studio.constitution
        })
      : {
          observation: observations[state.cycle_count % observations.length],
          score: null,
          reasons: ['Assigned by the experimental condition rather than selected by the attention agent.'],
          alternatives: []
        };
    await studio.writeCycleFile(cycleId, '01-observation.json', attention);
    await studio.ledger.append({ type: 'observation_selected', actor: 'role:attention', cycleId, payload: attention });

    const { necessity, intention } = await formAndLockIntention({
      provider,
      observation: attention.observation,
      state: agentState,
      constitution: studio.constitution
    });
    const intentionContent = {
      observation_id: attention.observation.id,
      necessity,
      intention
    };
    const intentionHash = sha256(canonicalize(intentionContent));
    const intentionRecord = {
      cycle_id: cycleId,
      locked_at: new Date().toISOString(),
      ...intentionContent,
      intention_commitment: intentionHash,
      intention_hash: intentionHash
    };
    await studio.writeCycleFile(cycleId, '02-locked-intention.json', { ...intentionRecord, intention_hash: intentionHash });
    await studio.ledger.append({
      type: 'intention_locked',
      actor: 'role:artist',
      cycleId,
      payload: intentionRecord
    });

    const candidates = await makeCandidates({
      provider,
      observation: attention.observation,
      necessity,
      intention,
      state: agentState,
      constitution: studio.constitution,
      experiment: studio.experiment,
      cycleId
    });
    await studio.writeCycleFile(cycleId, '03-candidates.json', candidates);
    await studio.ledger.append({ type: 'candidates_generated', actor: 'role:artist', cycleId, payload: { candidates } });

    const critiques = await runCriticPanel({
      provider,
      candidates,
      intention,
      state: agentState,
      constitution: studio.constitution
    });
    await studio.writeCycleFile(cycleId, '04-critiques.json', critiques);
    await studio.ledger.append({ type: 'critics_reported', actor: 'role:critics', cycleId, payload: { critiques } });

    let workingCandidates = candidates;
    let workingCritiques = critiques;
    let curation = await curate({
      provider,
      candidates: workingCandidates,
      critiques: workingCritiques,
      intention,
      state: agentState,
      constitution: studio.constitution,
      experiment: studio.experiment,
      allowRevision: activeFeatures.revision && studio.experiment.budgets.maximum_revision_rounds > 0
    });
    await studio.writeCycleFile(cycleId, '05-curation.json', curation);
    await studio.ledger.append({ type: 'curation_decided', actor: 'role:curator', cycleId, payload: { round: 0, ...curation } });

    if (!activeFeatures.refusal && curation.decision !== 'accept') {
      const forcedCandidateId = curation.ranking?.[0]?.candidate_id ?? workingCandidates[0]?.id;
      curation = {
        ...curation,
        decision: 'accept',
        selected_candidate_id: forcedCandidateId,
        forced_by_condition: true,
        rationale: `Forced acceptance condition overrode the curator. Original decision: ${curation.decision}. ${curation.rationale}`
      };
      await studio.ledger.append({
        type: 'curation_overridden_by_condition',
        actor: 'experiment-orchestrator',
        cycleId,
        payload: curation
      });
    }

    if (curation.decision === 'revise') {
      const original = workingCandidates.find((candidate) => candidate.id === curation.selected_candidate_id);
      const originalCritique = workingCritiques.find((critique) => critique.candidate_id === original.id);
      const revised = await provider.reviseCandidate({
        candidate: original,
        critique: originalCritique,
        intention,
        state: agentState,
        constitution: studio.constitution,
        cycleId
      });
      await studio.writeCycleFile(cycleId, '05a-revision.json', revised);
      await studio.ledger.append({
        type: 'candidate_revised',
        actor: 'role:editor',
        cycleId,
        payload: { parent_candidate_id: original.id, revised_candidate: revised }
      });

      const revisedCritique = await provider.critiqueCandidate({
        candidate: revised,
        intention,
        state: agentState,
        constitution: studio.constitution
      });
      workingCandidates = [...workingCandidates.filter((candidate) => candidate.id !== original.id), revised];
      workingCritiques = [...workingCritiques.filter((critique) => critique.candidate_id !== original.id), revisedCritique];
      await studio.writeCycleFile(cycleId, '05b-revision-critique.json', revisedCritique);
      await studio.ledger.append({ type: 'revision_critiqued', actor: 'role:critics', cycleId, payload: revisedCritique });

      curation = await curate({
        provider,
        candidates: workingCandidates,
        critiques: workingCritiques,
        intention,
        state: agentState,
        constitution: studio.constitution,
        experiment: studio.experiment,
        allowRevision: false
      });
      await studio.writeCycleFile(cycleId, '05c-final-curation.json', curation);
      await studio.ledger.append({ type: 'curation_decided', actor: 'role:curator', cycleId, payload: { round: 1, ...curation } });
    }

    const selected = curation.decision === 'accept'
      ? workingCandidates.find((candidate) => candidate.id === curation.selected_candidate_id)
      : null;
    const selectedCritique = selected
      ? workingCritiques.find((critique) => critique.candidate_id === selected.id)
      : null;

    let audiencePrediction = null;
    let artifactPath = null;
    let artifactAudit = null;
    let canonStatus = selected ? 'conceptual_only' : null;
    if (selected) {
      if (generateImage && provider.generateArtifact) {
        artifactPath = path.join(studio.cycleDirectory(cycleId), 'artifact.png');
        await provider.generateArtifact({ prompt: selected.generation_prompt, outputPath: artifactPath });
        await studio.ledger.append({
          type: 'artifact_generated',
          actor: 'image-provider',
          cycleId,
          payload: { candidate_id: selected.id, artifact_path: artifactPath }
        });

        artifactAudit = await provider.inspectArtifact({
          imagePath: artifactPath,
          candidate: selected,
          critique: selectedCritique,
          intention,
          constitution: studio.constitution,
          state: agentState
        });
        await studio.writeCycleFile(cycleId, '06-artifact-audit.json', artifactAudit);
        await studio.ledger.append({ type: 'artifact_audited', actor: 'visual-critic', cycleId, payload: artifactAudit });
        canonStatus = artifactAudit.recommended_action === 'accept_artifact' &&
          Number(artifactAudit.overall_score) >= studio.experiment.artifact_audit_threshold
          ? 'artifact_audit_passed'
          : artifactAudit.recommended_action === 'reject_artifact'
            ? 'concept_accepted_artifact_rejected'
            : 'concept_accepted_artifact_needs_revision';
        if (canonStatus !== 'artifact_audit_passed') {
          await studio.ledger.append({
            type: 'artifact_audit_not_passed',
            actor: 'role:curator',
            cycleId,
            payload: {
              candidate_id: selected.id,
              canon_status: canonStatus,
              threshold: studio.experiment.artifact_audit_threshold,
              audit: artifactAudit
            }
          });
        }
      }

      if (activeFeatures.audienceModel) audiencePrediction = await provider.predictAudience({
        selected,
        critique: selectedCritique,
        intention,
        artifactAudit,
        state: agentState
      });
      if (activeFeatures.audienceModel) {
        await studio.writeCycleFile(cycleId, '06b-audience-prediction.json', audiencePrediction);
        await studio.ledger.append({ type: 'audience_predicted', actor: 'role:audience-prediction', cycleId, payload: audiencePrediction });
      }
    }

    const memory = await consolidate({
      provider,
      observation: attention.observation,
      selection: selected,
      critiques: workingCritiques,
      curation,
      state,
      constitution: studio.constitution
    });
    if (!activeFeatures.surpriseCarryover) memory.active_surprises = [];
    await studio.writeCycleFile(cycleId, '07-memory-consolidation.json', memory);
    await studio.ledger.append({ type: 'memory_consolidated', actor: 'role:memory', cycleId, payload: memory });

    const nextState = {
      ...state,
      cycle_count: state.cycle_count + 1,
      last_cycle_id: cycleId,
      last_condition: condition,
      motifs: memory.motifs,
      observation_counts: memory.observation_counts,
      active_surprises: memory.active_surprises,
      unresolved_tensions: memory.unresolved_tensions,
      canon: selected
        ? [...state.canon, {
            cycle_id: cycleId,
            candidate_id: selected.id,
            title: selected.title,
            score: curation.score,
            intention_hash: intentionHash,
            artifact_path: artifactPath,
            canon_status: canonStatus,
            artifact_audit_score: artifactAudit?.overall_score ?? null
          }]
        : state.canon,
      rejected: selected
        ? state.rejected
        : [...state.rejected, { cycle_id: cycleId, rationale: curation.rationale, best_score: curation.score }]
    };

    const manifest = {
      cycle_id: cycleId,
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
    await studio.ledger.append({ type: 'cycle_completed', actor: 'orchestrator', cycleId, payload: manifest });
    await studio.saveState(nextState);

    const verification = await studio.ledger.verify();
    if (!verification.valid) throw new Error(`Ledger failed after cycle: ${verification.error}`);

    return { cycleId, attention, necessity, intention, intentionHash, candidates: workingCandidates, critiques: workingCritiques, curation, selected, artifactPath, artifactAudit, canonStatus, audiencePrediction, memory, state: nextState, verification };
  } catch (error) {
    const events = await studio.ledger.readAll();
    if (!terminalEventForCycle(events, cycleId)) {
      await studio.ledger.append({
        type: 'cycle_failed',
        actor: 'orchestrator',
        cycleId,
        payload: { name: error.name, message: error.message }
      });
    }
    throw error;
  }
}
