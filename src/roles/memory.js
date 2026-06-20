export async function consolidate({ provider, observation, selection, critiques, curation, state, constitution }) {
  return provider.consolidateMemory({ observation, selection, critiques, curation, state, constitution });
}
