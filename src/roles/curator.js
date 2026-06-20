export async function curate({ provider, candidates, critiques, intention, state, constitution, experiment, allowRevision = false }) {
  const decision = await provider.curate({ candidates, critiques, intention, state, constitution, experiment, allowRevision });
  if (!['accept', 'revise', 'reject_all'].includes(decision?.decision)) {
    throw new Error(`Invalid curator decision: ${decision?.decision}`);
  }
  if (decision.decision !== 'reject_all' && !candidates.some((candidate) => candidate.id === decision.selected_candidate_id)) {
    throw new Error('Curator selected a candidate that does not exist.');
  }
  return decision;
}
