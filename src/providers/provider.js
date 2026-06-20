export class CreativeProvider {
  get name() {
    throw new Error('Provider must expose a name.');
  }

  async selectObservation() { throw new Error('Not implemented'); }
  async formNecessity() { throw new Error('Not implemented'); }
  async lockIntention() { throw new Error('Not implemented'); }
  async generateCandidates() { throw new Error('Not implemented'); }
  async critiqueCandidate() { throw new Error('Not implemented'); }
  async reviseCandidate() { throw new Error('Not implemented'); }
  async curate() { throw new Error('Not implemented'); }
  async predictAudience() { throw new Error('Not implemented'); }
  async consolidateMemory() { throw new Error('Not implemented'); }
  async generateArtifact() { return null; }
  async inspectArtifact() { return null; }
}
