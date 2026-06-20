export async function chooseObservation({ provider, observations, state, constitution }) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error('At least one observation is required.');
  }
  const result = await provider.selectObservation({ observations, state, constitution });
  if (!result?.observation?.id) throw new Error('Attention agent did not select a valid observation.');
  return result;
}
