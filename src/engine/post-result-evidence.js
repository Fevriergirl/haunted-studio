import { id } from '../core/ids.js';

const COMPARISON_CLASSIFICATIONS = new Set([
  'expected_realization',
  'planned_variation',
  'neutral_deviation',
  'technical_failure',
  'random_incoherence',
  'potentially_productive_surprise',
  'unresolved'
]);

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function confidence(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be between 0 and 1.`);
  return number;
}

function baseEvidence({ cycleId, artifactId, artifactHash, sourceRole, sourceType, classification, confidenceValue, lockEventId }) {
  return {
    evidence_id: id('evidence'),
    cycle_id: cycleId,
    artifact_id: artifactId,
    source_role: sourceRole,
    source_type: sourceType,
    timestamp: new Date().toISOString(),
    schema_version: 1,
    code_commit: process.env.GITHUB_SHA ?? null,
    artifact_hash: artifactHash,
    locked_intention_event_id: lockEventId,
    confidence: confidenceValue,
    classification,
    review_status: 'unreviewed',
    memory_eligible: false,
    later_used: false
  };
}

export function normalizeCandidatePlan(candidate = {}) {
  const planned = [];
  if (Array.isArray(candidate.planned_ambiguities)) planned.push(...candidate.planned_ambiguities.filter((item) => typeof item === 'string' && item.trim()));
  if (typeof candidate.planned_ambiguity === 'string' && candidate.planned_ambiguity.trim()) planned.push(candidate.planned_ambiguity.trim());
  const legacy = typeof candidate.proposed_accident === 'string' && candidate.proposed_accident.trim()
    ? candidate.proposed_accident.trim()
    : null;
  if (legacy && !planned.includes(legacy)) planned.push(legacy);
  return {
    anticipated_risks: [candidate.anticipated_risk].filter((item) => typeof item === 'string' && item.trim()),
    planned_ambiguities: [...new Set(planned)],
    planned_variations: Array.isArray(candidate.planned_variations) ? candidate.planned_variations : [],
    ...(legacy ? { legacy_source_field: 'proposed_accident' } : {})
  };
}

export function normalizeNewCandidate(candidate) {
  const normalized = { ...candidate };
  if (!normalized.planned_ambiguity && normalized.proposed_accident) normalized.planned_ambiguity = normalized.proposed_accident;
  delete normalized.proposed_accident;
  return normalized;
}

export function buildWitnessPayload({ output, cycleId, artifactId, artifactHash, lockEventId }) {
  const observations = requireArray(requireRecord(output, 'witness output').observations, 'witness observations')
    .map((observation, index) => {
      requireRecord(observation, `witness observations[${index}]`);
      return {
        ...baseEvidence({
          cycleId, artifactId, artifactHash, lockEventId,
          sourceRole: 'artifact_witness', sourceType: 'artifact_observation',
          classification: 'artifact_observation', confidenceValue: confidence(observation.confidence, `witness observations[${index}].confidence`)
        }),
        description: requireText(observation.description, `witness observations[${index}].description`),
        observable_support: typeof observation.observable_support === 'string' ? observation.observable_support.trim() : ''
      };
    });
  return { artifact_id: artifactId, artifact_hash: artifactHash, observations };
}

export function buildComparisonPayload({ output, witness, plan = {}, cycleId, artifactId, artifactHash, lockEventId }) {
  const witnessIds = new Set(witness.observations.map((item) => item.evidence_id));
  const comparisons = requireArray(requireRecord(output, 'comparison output').comparisons, 'comparisons')
    .map((comparison, index) => {
      requireRecord(comparison, `comparisons[${index}]`);
      if (!witnessIds.has(comparison.witness_evidence_id)) {
        throw new Error(`comparisons[${index}] references unknown witness evidence.`);
      }
      if (!COMPARISON_CLASSIFICATIONS.has(comparison.classification)) {
        throw new Error(`comparisons[${index}] has invalid classification ${comparison.classification}.`);
      }
      const description = requireText(comparison.description, `comparisons[${index}].description`);
      const normalizedDescription = description.toLowerCase();
      const matchesPlan = [...(plan.planned_ambiguities ?? []), ...(plan.planned_variations ?? [])]
        .some((item) => typeof item === 'string' && item.trim() &&
          (normalizedDescription.includes(item.trim().toLowerCase()) || item.trim().toLowerCase().includes(normalizedDescription)));
      return {
        ...baseEvidence({
          cycleId, artifactId, artifactHash, lockEventId,
          sourceRole: 'deviation_comparator', sourceType: 'artifact_deviation',
          classification: comparison.classification,
          confidenceValue: confidence(comparison.confidence, `comparisons[${index}].confidence`)
        }),
        witness_evidence_id: comparison.witness_evidence_id,
        description,
        explicitly_planned: comparison.explicitly_planned === true || matchesPlan,
        observable_support: comparison.observable_support === true,
        coherent: comparison.coherent === true,
        material_interpretive_change: comparison.material_interpretive_change === true,
        relates_to_work: comparison.relates_to_work === true
      };
    });
  return {
    artifact_id: artifactId,
    artifact_hash: artifactHash,
    witness_evidence_ids: witness.observations.map((item) => item.evidence_id),
    comparisons
  };
}

export function buildReviewPayload({ output, witness, comparison, cycleId, artifactId, artifactHash, lockEventId }) {
  const reviewOutput = requireRecord(output, 'surprise review output');
  const reviews = requireArray(reviewOutput.reviews, 'surprise reviews');
  const reviewByComparison = new Map(reviews.map((review, index) => {
    requireRecord(review, `surprise reviews[${index}]`);
    if (!['confirmed', 'rejected', 'unresolved'].includes(review.status)) throw new Error(`surprise reviews[${index}] has invalid status.`);
    return [review.comparison_evidence_id, review];
  }));
  const witnessById = new Map(witness.observations.map((item) => [item.evidence_id, item]));
  const reviewed = comparison.comparisons.map((item) => {
    const witnessItem = witnessById.get(item.witness_evidence_id);
    const review = reviewByComparison.get(item.evidence_id);
    let classification = item.classification;
    let reviewStatus = 'not_applicable';
    let memoryEligible = false;
    let reviewConfidence = item.confidence;
    let challenges = [];

    if (item.classification === 'potentially_productive_surprise') {
      const criteriaSatisfied = !item.explicitly_planned && item.observable_support && Boolean(witnessItem?.observable_support) &&
        item.coherent && item.material_interpretive_change && item.relates_to_work;
      reviewStatus = review?.status ?? 'rejected';
      reviewConfidence = review ? confidence(review.confidence, 'surprise review confidence') : item.confidence;
      challenges = Array.isArray(review?.challenges) ? review.challenges : ['No independent review supplied.'];
      if (criteriaSatisfied && reviewStatus === 'confirmed') {
        classification = 'productive_surprise';
        memoryEligible = true;
      } else if (reviewStatus === 'unresolved') {
        classification = 'unresolved_deviation';
      } else {
        classification = 'rejected_accident';
      }
    } else if (item.classification === 'unresolved') {
      classification = 'unresolved_deviation';
    } else if (item.classification === 'technical_failure') {
      classification = 'generation_error';
    } else if (item.classification === 'random_incoherence') {
      classification = 'rejected_accident';
    }

    return {
      ...baseEvidence({
        cycleId, artifactId, artifactHash, lockEventId,
        sourceRole: 'adversarial_surprise_reviewer', sourceType: classification,
        classification, confidenceValue: reviewConfidence
      }),
      comparison_evidence_id: item.evidence_id,
      witness_evidence_ids: [item.witness_evidence_id],
      description: item.description,
      review_status: reviewStatus,
      memory_eligible: memoryEligible,
      challenges
    };
  });
  return {
    artifact_id: artifactId,
    artifact_hash: artifactHash,
    comparison_evidence_id: comparison.comparisons[0]?.evidence_id ?? null,
    no_productive_surprise: reviewed.every((item) => item.classification !== 'productive_surprise'),
    reviewed_evidence: reviewed
  };
}

export function evidenceResultFromEvents(cycleEvents) {
  const unavailable = cycleEvents.find((event) => event.type === 'post_result_evidence_unavailable');
  if (unavailable) return { status: 'unavailable', reason: unavailable.payload.reason, observations: [], comparisons: [], reviewed: [], confirmed_surprises: [] };
  const witness = cycleEvents.find((event) => event.type === 'artifact_witnessed')?.payload;
  const comparison = cycleEvents.find((event) => event.type === 'artifact_deviations_compared')?.payload;
  const review = cycleEvents.find((event) => event.type === 'surprise_reviewed')?.payload;
  const reviewed = review?.reviewed_evidence ?? [];
  return {
    status: witness ? 'available' : 'not_recorded',
    observations: witness?.observations ?? [],
    comparisons: comparison?.comparisons ?? [],
    reviewed,
    confirmed_surprises: reviewed.filter((item) => item.classification === 'productive_surprise' && item.review_status === 'confirmed')
  };
}
