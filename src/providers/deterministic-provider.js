import { createHash } from 'node:crypto';
import { clamp, roundScore, weightedScore } from '../core/scoring.js';

function stableNumber(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16) / 0xffffffff;
}

function overlap(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item)).length;
}

function motifPressure(observation, state) {
  const known = Object.keys(state.motifs ?? {});
  const recurrence = overlap(observation.tags, known) * 0.11;
  const seenCount = state.observation_counts?.[observation.id] ?? 0;
  const saturation = seenCount * 0.17;
  const unresolved = (state.unresolved_tensions ?? []).filter((tension) =>
    observation.tags.some((tag) => tension.toLowerCase().includes(tag.replaceAll('-', ' ')))
  ).length * 0.16;
  const novelty = observation.tags.filter((tag) => !known.includes(tag)).length * 0.08;
  return recurrence + unresolved + novelty - saturation;
}

export class DeterministicProvider {
  get supportsPostResultEvidence() {
    return true;
  }

  get name() {
    return 'deterministic';
  }

  async selectObservation({ observations, state }) {
    const ranked = observations.map((observation) => {
      const base = stableNumber(`${observation.id}:${state.cycle_count}`) * 0.28;
      const pressure = motifPressure(observation, state);
      return {
        observation,
        score: roundScore(clamp(0.35 + base + pressure)),
        reasons: [
          pressure > 0.2 ? 'It touches material already under pressure in the studio history.' : 'It introduces material not yet metabolized by the studio.',
          observation.tags.length > 3 ? 'It contains several meanings that can collide without being resolved.' : 'Its apparent simplicity leaves room for formal transformation.'
        ]
      };
    }).sort((a, b) => b.score - a.score);

    return { ...ranked[0], alternatives: ranked.slice(1, 3).map(({ observation, score }) => ({ id: observation.id, score })) };
  }

  async formNecessity({ observation, state }) {
    const recurring = observation.tags.filter((tag) => state.motifs?.[tag]);
    return {
      statement: `This work should exist because ${observation.text.toLowerCase()} contains a conflict between what is visibly controlled and what cannot actually be contained.`,
      pressure_sources: [
        recurring.length ? `Recurring studio material: ${recurring.join(', ')}` : 'An untested pressure in the observation stream',
        'The difference between explanation and encounter',
        'The risk that a polished image will make the conflict too easy to consume'
      ],
      failure_if_unmade: 'The observation remains an anecdote instead of becoming a structure the viewer must inhabit.',
      confidence: roundScore(0.63 + stableNumber(observation.id) * 0.25)
    };
  }

  async lockIntention({ observation, necessity, state }) {
    const primary = observation.tags[0] ?? 'attention';
    const secondary = observation.tags[1] ?? 'absence';
    return {
      about: `The cost of maintaining ${primary} when ${secondary} has already altered the room.`,
      viewer_encounter: 'The viewer should first trust the ordinary scene, then discover that its logic is quietly impossible.',
      formal_tension: 'Rigid order against one physically understated impossibility.',
      must_include: [
        'one ordinary action or object rendered with material specificity',
        'one impossible fact treated as normal',
        'an area of unresolved visual silence'
      ],
      must_avoid: [
        'horror-poster lighting',
        'explanatory symbols',
        'uniformly distressed surfaces',
        'a centered reveal that announces the concept immediately'
      ],
      anticipated_risk: state.cycle_count === 0
        ? 'The first cycle may mistake atmosphere for a point of view.'
        : 'The studio may repeat an earlier motif because it has already learned how to make it attractive.',
      revision_question: 'What can be removed while making the contradiction harder to escape?'
    };
  }

  async generateCandidates({ observation, intention, count, cycleId }) {
    const strategies = [
      {
        name: 'Peripheral evidence',
        structure: 'Place the impossible fact outside the compositional center so the viewer discovers it after accepting the room.',
        accident: 'A repair line begins to resemble a boundary around an absent body.'
      },
      {
        name: 'Ritual under pressure',
        structure: 'Make a repetitive domestic action carry the image while architecture registers the pressure indirectly.',
        accident: 'The most orderly object casts the least physically plausible shadow.'
      },
      {
        name: 'False hospitality',
        structure: 'Construct a beautiful invitation into a space whose proportions quietly prevent entry.',
        accident: 'A welcoming pattern becomes denser exactly where passage should be possible.'
      },
      {
        name: 'Afterimage',
        structure: 'Show evidence that a figure has left without clarifying whether departure was escape, erasure, or refusal.',
        accident: 'The room appears to remember the figure more precisely than any reflective surface does.'
      },
      {
        name: 'Material contradiction',
        structure: 'Give one fragile material structural authority and one solid material the behavior of fabric.',
        accident: 'The object meant to stabilize the scene appears to be yielding first.'
      }
    ];

    return Array.from({ length: count }, (_, index) => {
      const strategy = strategies[index % strategies.length];
      return {
        id: `candidate_${cycleId}_${index + 1}`,
        title: `${strategy.name}: ${observation.tags[index % observation.tags.length] ?? 'study'}`,
        strategy: strategy.name,
        artifact_brief: `${strategy.structure} The scene is grounded in: ${observation.text} The work pursues: ${intention.about}`,
        composition: {
          entry_point: index === 0 ? 'an ordinary object near the lower third' : index === 1 ? 'a repeated gesture near one edge' : 'a plausible doorway or reflective plane',
          delayed_discovery: strategy.accident,
          visual_silence: 'At least one quarter of the frame carries no symbolic explanation.'
        },
        planned_ambiguity: strategy.accident,
        medium: index === 1 ? 'staged photograph of an impossible room' : index === 2 ? 'large-format constructed photograph' : 'photoreal staged interior image',
        generation_prompt: `Create a materially convincing ${index === 1 ? 'staged photograph' : 'photoreal image'} based on this brief: ${strategy.structure} ${observation.text} Avoid ${intention.must_avoid.join(', ')}. Do not add text. Treat the impossible element as an ordinary physical fact.`,
        seed_signature: stableNumber(`${cycleId}:${index}:${observation.id}`)
      };
    });
  }

  async critiqueCandidate({ candidate, intention, state, constitution }) {
    const signature = candidate.seed_signature;
    const historicalRepeat = Object.keys(state.motifs ?? {}).filter((motif) => candidate.artifact_brief.includes(motif)).length;
    const scores = {
      formal: roundScore(0.58 + signature * 0.3),
      truth: roundScore(0.5 + stableNumber(`${candidate.id}:truth`) * 0.4),
      historical: roundScore(clamp(0.72 - historicalRepeat * 0.07 + stableNumber(`${candidate.id}:history`) * 0.2)),
      adversarial_survival: roundScore(0.45 + stableNumber(`${candidate.id}:adversary`) * 0.45),
      // This is a pre-result forecast used by the existing scoring model, not
      // evidence that productive surprise occurred.
      productive_surprise: roundScore(0.48 + stableNumber(candidate.planned_ambiguity ?? candidate.id) * 0.44)
    };

    const shortcutFindings = constitution.forbidden_shortcuts
      .filter((shortcut) => {
        // Negative prompt language is not evidence that the proposed artifact contains a shortcut.
        const text = `${candidate.artifact_brief} ${candidate.strategy} ${candidate.composition?.delayed_discovery ?? ''}`.toLowerCase();
        if (shortcut.id === 'F1') return text.includes('cinematic lighting');
        if (shortcut.id === 'F2') return text.includes('decay') || text.includes('distressed');
        if (shortcut.id === 'F3') return text.includes('symbol');
        if (shortcut.id === 'F6') return historicalRepeat > 2;
        return false;
      })
      .map((shortcut) => ({ id: shortcut.id, finding: shortcut.pattern, penalty: shortcut.penalty }));

    const strongestObjection = scores.truth < 0.64
      ? 'The candidate may stage an intelligent contradiction without making it emotionally consequential.'
      : scores.historical < 0.64
        ? 'The candidate may be developing a house style instead of developing a thought.'
        : 'The delayed discovery may still function as a clever reveal rather than a change in the viewer’s understanding.';

    return {
      candidate_id: candidate.id,
      scores,
      confidence: roundScore(0.68 + stableNumber(`${candidate.id}:confidence`) * 0.22),
      formal_read: 'The composition has a clear entry point and withholds the impossible fact long enough to create a second reading.',
      truth_read: scores.truth >= 0.66 ? 'The formal contradiction serves the stated necessity.' : 'The work is at risk of illustrating the necessity instead of embodying it.',
      historical_read: historicalRepeat ? `It reuses ${historicalRepeat} known motif connections and must alter their stakes.` : 'It introduces a formal route not yet canonicalized.',
      strongest_objection: strongestObjection,
      shortcut_findings: shortcutFindings,
      revision: scores.truth < 0.66
        ? 'Remove the most legible clue and make the ordinary action more materially exact.'
        : 'Preserve the accident, but reduce any lighting or framing that announces its importance.',
      intention_alignment: `${candidate.artifact_brief} ${candidate.generation_prompt}`.includes(intention.about) ? 0.82 : 0.55
    };
  }

  async reviseCandidate({ candidate, critique, intention, cycleId }) {
    return {
      ...candidate,
      id: `${candidate.id}_revision_1`,
      title: `${candidate.title} (revised)`,
      artifact_brief: `${candidate.artifact_brief} Revision: ${critique.revision}`,
      composition: {
        ...candidate.composition,
        revision: critique.revision,
        visual_silence: 'Increase unassigned space and remove the most immediately legible clue.'
      },
      generation_prompt: `${candidate.generation_prompt} REVISION REQUIREMENT: ${critique.revision} Preserve material plausibility and the understated impossible fact.`,
      parent_candidate_id: candidate.id,
      revision_reason: critique.strongest_objection,
      seed_signature: stableNumber(`${cycleId}:${candidate.id}:revision`)
    };
  }

  async curate({ candidates, critiques, experiment, allowRevision = false }) {
    const ranked = candidates.map((candidate) => {
      const critique = critiques.find((item) => item.candidate_id === candidate.id);
      const base = weightedScore(critique.scores, experiment.weights);
      const penalty = critique.shortcut_findings.reduce((sum, finding) => sum + finding.penalty, 0);
      const score = roundScore(base - penalty);
      return { candidate, critique, score, penalty: roundScore(penalty) };
    }).sort((a, b) => b.score - a.score);

    const winner = ranked[0];
    const accepted = Boolean(winner && winner.score >= experiment.canon_threshold && winner.critique.confidence >= experiment.minimum_critic_confidence);
    const revisable = Boolean(
      !accepted &&
      allowRevision &&
      winner &&
      winner.score >= experiment.revision_threshold &&
      winner.critique.confidence >= experiment.minimum_critic_confidence
    );
    const decision = accepted ? 'accept' : revisable ? 'revise' : 'reject_all';

    return {
      decision,
      selected_candidate_id: decision === 'reject_all' ? null : winner?.candidate.id ?? null,
      score: winner?.score ?? 0,
      threshold: experiment.canon_threshold,
      revision_threshold: experiment.revision_threshold,
      rationale: accepted
        ? `The selected candidate survives the independent critics with a score of ${winner.score}; its planned ambiguity remains a hypothesis until post-result review.`
        : revisable
          ? `The strongest candidate scores ${winner.score}. It is not ready for canon, but the critics identify a specific repair rather than a failed premise.`
          : `No candidate met the ${experiment.canon_threshold} canon threshold or the conditions for a disciplined revision.`,
      conditions: decision === 'reject_all'
        ? ['Reform the necessity or choose a different observation before generating again.']
        : [winner.critique.revision],
      ranking: ranked.map(({ candidate, score, penalty }) => ({ candidate_id: candidate.id, score, penalty }))
    };
  }

  async predictAudience({ selected, critique }) {
    return {
      first_notice: selected.composition.entry_point,
      likely_second_discovery: selected.composition.delayed_discovery,
      likely_misreading: 'Some viewers may read the impossible detail as genre horror rather than as pressure inside ordinary life.',
      hoped_lingering_effect: 'The viewer reconsiders whether order in the scene is evidence of safety or evidence of containment.',
      subtlety_risk: critique.scores.truth < 0.7 ? 'The concept may become legible too quickly.' : 'The withholding may be mistaken for mere ambiguity.',
      questions_for_humans: [
        'What did you notice first?',
        'At what moment did the room stop behaving normally?',
        'What felt too explained?',
        'What remained with you after the image was gone?'
      ]
    };
  }

  async witnessArtifact({ artifact_id: artifactId, artifact_hash: artifactHash }) {
    return {
      observations: [{
        description: `The deterministic offline witness received artifact ${artifactId} with recorded content hash ${artifactHash}. It makes no unverified visual claim.`,
        observable_support: `artifact_hash:${artifactHash}`,
        confidence: 1
      }]
    };
  }

  async compareArtifactDeviation({ witness }) {
    return {
      comparisons: witness.observations.map((observation) => ({
        witness_evidence_id: observation.evidence_id,
        classification: 'expected_realization',
        description: 'The offline deterministic witness supplies no observable basis for an unplanned deviation.',
        confidence: 1,
        explicitly_planned: false,
        observable_support: true,
        coherent: true,
        material_interpretive_change: false,
        relates_to_work: false
      }))
    };
  }

  async reviewSurprise() {
    return { reviews: [], no_productive_surprise: true };
  }

  async inspectArtifact({ candidate }) {
    return {
      status: 'not_generated',
      candidate_id: candidate.id,
      overall_score: null,
      recommended_action: 'generate_before_visual_judgment',
      scores: null,
      observations: ['The offline provider can evaluate the concept and history, but it cannot pretend it saw an image that was never generated.'],
      failures: [],
      strongest_accident: null
    };
  }

  async consolidateMemory({ observation, selection, critiques, curation, state }) {
    const motifs = { ...(state.motifs ?? {}) };
    const observationCounts = { ...(state.observation_counts ?? {}) };
    observationCounts[observation.id] = (observationCounts[observation.id] ?? 0) + 1;
    for (const tag of observation.tags) {
      motifs[tag] = (motifs[tag] ?? 0) + 1;
    }

    const selectedCritique = critiques.find((item) => item.candidate_id === curation.selected_candidate_id);
    const unresolved = [...(state.unresolved_tensions ?? [])];
    const tension = selectedCritique?.scores.truth < 0.7
      ? `How can ${observation.tags[0]} be embodied without becoming an explanatory symbol?`
      : `When does formal control around ${observation.tags[0]} become evidence of pressure rather than mastery?`;
    if (!unresolved.includes(tension)) unresolved.push(tension);

    // PR 2A deliberately does not promote a planned candidate field into
    // autobiographical surprise. Typed evidence-driven memory is PR 2B.
    const activeSurprises = [...(state.active_surprises ?? [])];

    return {
      motifs,
      observation_counts: observationCounts,
      active_surprises: activeSurprises.slice(-8),
      unresolved_tensions: unresolved.slice(-12),
      lesson: curation.decision === 'accept'
        ? `The studio accepted ${selection.title}, but its next use of ${observation.tags[0]} must change the stakes rather than repeat the appearance.`
        : 'Rejection is retained as evidence that atmosphere and coherence are not sufficient for canon.',
      future_obligation: curation.decision === 'accept'
        ? `A later cycle must either contradict, deepen, or abandon the selected candidate's use of ${observation.tags[0]}.`
        : 'A later cycle should test whether a quieter formal structure can carry the same necessity.'
    };
  }
}
