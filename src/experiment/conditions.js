export const DEFAULT_FEATURES = Object.freeze({
  autobiographicalMemory: true,
  selfDirectedAttention: true,
  refusal: true,
  revision: true,
  audienceModel: true,
  surpriseCarryover: true
});

export const EXPERIMENT_CONDITIONS = Object.freeze({
  full: {
    label: 'Full Haunted Studio',
    features: { ...DEFAULT_FEATURES }
  },
  no_memory: {
    label: 'No autobiographical memory',
    features: { ...DEFAULT_FEATURES, autobiographicalMemory: false, surpriseCarryover: false }
  },
  assigned_attention: {
    label: 'Assigned attention',
    features: { ...DEFAULT_FEATURES, selfDirectedAttention: false }
  },
  forced_acceptance: {
    label: 'No refusal',
    features: { ...DEFAULT_FEATURES, refusal: false, revision: false }
  },
  no_audience_model: {
    label: 'No audience prediction',
    features: { ...DEFAULT_FEATURES, audienceModel: false }
  },
  no_surprise_carryover: {
    label: 'No surprise carryover',
    features: { ...DEFAULT_FEATURES, surpriseCarryover: false }
  }
});

export function resolveFeatures(overrides = {}) {
  return { ...DEFAULT_FEATURES, ...overrides };
}
