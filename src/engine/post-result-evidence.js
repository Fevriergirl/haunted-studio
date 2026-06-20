import { id } from '../core/ids.js';
import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical-json.js';

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

function planItemId(classification, description, sourceEventId, sourceCandidateId) {
  return `plan_${createHash('sha256').update(canonicalize({
    classification, description, source_event_id: sourceEventId, source_candidate_id: sourceCandidateId
  })).digest('hex').slice(0, 24)}`;
}

export function normalizeCandidatePlan(candidate = {}, {
  lockedIntention = {}, lockEventId = null, candidateSourceEventId = null,
  candidateId = candidate.id ?? null, originalCandidate = null, revisionSourceEventId = null
} = {}) {
  const planned = [];
  if (Array.isArray(candidate.planned_ambiguities)) planned.push(...candidate.planned_ambiguities.filter((item) => typeof item === 'string' && item.trim()));
  if (typeof candidate.planned_ambiguity === 'string' && candidate.planned_ambiguity.trim()) planned.push(candidate.planned_ambiguity.trim());
  const legacy = typeof candidate.proposed_accident === 'string' && candidate.proposed_accident.trim()
    ? candidate.proposed_accident.trim()
    : null;
  if (legacy && !planned.includes(legacy)) planned.push(legacy);
  const lockedRisks = [lockedIntention.anticipated_risk, ...(lockedIntention.anticipated_risks ?? [])]
    .filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  const candidateRisks = [candidate.anticipated_risk]
    .filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  const risks = [...new Set([...lockedRisks, ...candidateRisks])];
  const variations = Array.isArray(candidate.planned_variations)
    ? candidate.planned_variations.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
  const originalHas = (classification, description) => {
    if (!originalCandidate) return false;
    const values = classification === 'planned_ambiguity'
      ? [originalCandidate.planned_ambiguity, originalCandidate.proposed_accident, ...(originalCandidate.planned_ambiguities ?? [])]
      : classification === 'planned_variation'
        ? originalCandidate.planned_variations ?? []
        : [originalCandidate.anticipated_risk, ...(originalCandidate.anticipated_risks ?? [])];
    return values.includes(description);
  };
  const candidateSource = (classification, description) => originalHas(classification, description)
    ? { sourceEventId: candidateSourceEventId, sourceCandidateId: originalCandidate.id }
    : { sourceEventId: revisionSourceEventId ?? candidateSourceEventId, sourceCandidateId: candidateId };
  const planItems = [
    ...[...new Set(lockedRisks)].map((description) => ({ classification: 'anticipated_risk', description, sourceEventId: lockEventId, sourceCandidateId: null })),
    ...[...new Set(candidateRisks)].map((description) => ({ classification: 'anticipated_risk', description, ...candidateSource('anticipated_risk', description) })),
    ...[...new Set(planned)].map((description) => ({ classification: 'planned_ambiguity', description, ...candidateSource('planned_ambiguity', description) })),
    ...[...new Set(variations)].map((description) => ({ classification: 'planned_variation', description, ...candidateSource('planned_variation', description) }))
  ].map((item) => ({
    plan_item_id: planItemId(item.classification, item.description, item.sourceEventId, item.sourceCandidateId),
    classification: item.classification,
    description: item.description,
    source_event_id: item.sourceEventId,
    source_candidate_id: item.sourceCandidateId,
    intentional: true
  }));
  return {
    anticipated_risks: [...new Set(risks)],
    planned_ambiguities: [...new Set(planned)],
    planned_variations: variations,
    plan_items: planItems,
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
  const planById = new Map((plan.plan_items ?? []).map((item) => [item.plan_item_id, item]));
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
      const suppliedPlanIds = requireArray(comparison.related_plan_item_ids ?? [], `comparisons[${index}].related_plan_item_ids`);
      if (suppliedPlanIds.some((itemId) => !planById.has(itemId))) throw new Error(`comparisons[${index}] references unknown plan item.`);
      const matchedPlanIds = [...planById.values()]
        .filter((item) => normalizedDescription.includes(item.description.toLowerCase()) || item.description.toLowerCase().includes(normalizedDescription))
        .map((item) => item.plan_item_id);
      const relatedPlanItemIds = [...new Set([...suppliedPlanIds, ...matchedPlanIds])];
      return {
        ...baseEvidence({
          cycleId, artifactId, artifactHash, lockEventId,
          sourceRole: 'deviation_comparator', sourceType: 'artifact_deviation',
          classification: comparison.classification,
          confidenceValue: confidence(comparison.confidence, `comparisons[${index}].confidence`)
        }),
        witness_evidence_id: comparison.witness_evidence_id,
        description,
        explicitly_planned: comparison.explicitly_planned === true || relatedPlanItemIds.length > 0,
        related_plan_item_ids: relatedPlanItemIds,
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
    plan_items: plan.plan_items ?? [],
    comparisons
  };
}

export function buildReviewPayload({ output, witness, comparison, cycleId, artifactId, artifactHash, lockEventId }) {
  const reviewOutput = requireRecord(output, 'surprise review output');
  const reviews = requireArray(reviewOutput.reviews, 'surprise reviews');
  const provisionalIds = new Set(comparison.comparisons.filter((item) => item.classification === 'potentially_productive_surprise').map((item) => item.evidence_id));
  const reviewByComparison = new Map();
  reviews.forEach((review, index) => {
    requireRecord(review, `surprise reviews[${index}]`);
    if (!['confirmed', 'rejected', 'unresolved'].includes(review.status)) throw new Error(`surprise reviews[${index}] has invalid status.`);
    if (!provisionalIds.has(review.comparison_evidence_id)) throw new Error(`surprise reviews[${index}] references unknown provisional comparison.`);
    if (reviewByComparison.has(review.comparison_evidence_id)) throw new Error(`surprise reviews[${index}] duplicates a comparison review.`);
    reviewByComparison.set(review.comparison_evidence_id, review);
  });
  if (reviewByComparison.size !== provisionalIds.size) throw new Error('Every provisional surprise requires one adversarial review.');
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
      const findings = review?.findings;
      const reviewChallenges = Array.isArray(review?.challenges) ? review.challenges.filter((value) => typeof value === 'string' && value.trim()) : [];
      if (review?.status === 'confirmed') {
        requireRecord(findings, 'confirmed surprise adversarial findings');
        if (reviewChallenges.length === 0) throw new Error('Confirmed surprise requires adversarial challenges.');
      }
      const adversariallySupported = findings && findings.planned === false && findings.trivial === false &&
        findings.incoherent === false && findings.common_in_prior_work === false && findings.technical_defect === false &&
        findings.falsely_inferred === false && findings.observable_support === true &&
        findings.material_interpretive_change === true && findings.relates_to_work === true;
      const criteriaSatisfied = !item.explicitly_planned && (item.related_plan_item_ids?.length ?? 0) === 0 &&
        item.observable_support && Boolean(witnessItem?.observable_support) &&
        item.coherent && item.material_interpretive_change && item.relates_to_work;
      reviewStatus = review?.status ?? 'rejected';
      reviewConfidence = review ? confidence(review.confidence, 'surprise review confidence') : item.confidence;
      if (reviewStatus === 'confirmed' && reviewConfidence === 0) throw new Error('Confirmed surprise requires positive review confidence.');
      challenges = reviewChallenges.length ? reviewChallenges : ['No independent review supplied.'];
      if (criteriaSatisfied && adversariallySupported && reviewStatus === 'confirmed') {
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
      challenges,
      adversarial_findings: review?.findings ?? null
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
