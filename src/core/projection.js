const GENESIS_HASH = '0'.repeat(64);

export const INITIAL_STATE = {
  version: 2,
  cycle_count: 0,
  canon: [],
  rejected: [],
  motifs: {},
  observation_counts: {},
  active_surprises: [],
  unresolved_tensions: [],
  audience_findings: [],
  corrections: [],
  incomplete_cycles: [],
  last_cycle_id: null,
  ledger_head: {
    sequence: 0,
    event_id: null,
    event_hash: GENESIS_HASH,
    schema_version: 0
  }
};

function headIdentity(event) {
  if (!event) return structuredClone(INITIAL_STATE.ledger_head);
  return {
    sequence: event.sequence,
    event_id: event.event_id,
    event_hash: event.hash,
    schema_version: event.schema_version ?? 0
  };
}

function applyCompletedCycle(state, event, cycleEvents) {
  const manifest = event.payload;
  const memory = cycleEvents.findLast((item) => item.type === 'memory_consolidated')?.payload;
  if (memory) {
    state.motifs = memory.motifs ?? state.motifs;
    state.observation_counts = memory.observation_counts ?? state.observation_counts;
    state.active_surprises = memory.active_surprises ?? state.active_surprises;
    state.unresolved_tensions = memory.unresolved_tensions ?? state.unresolved_tensions;
  }
  state.cycle_count += 1;
  state.last_cycle_id = manifest.cycle_id ?? event.cycle_id;
  state.last_condition = manifest.condition ?? null;
  if (manifest.selected_candidate) {
    state.canon.push({
      cycle_id: manifest.cycle_id ?? event.cycle_id,
      candidate_id: manifest.selected_candidate.id,
      title: manifest.selected_candidate.title,
      score: manifest.curation?.score ?? null,
      intention_hash: manifest.intention_hash,
      artifact_path: manifest.artifact_path ?? null,
      canon_status: manifest.canon_status ?? 'legacy_unspecified',
      artifact_audit_score: manifest.artifact_audit?.overall_score ?? null
    });
  } else {
    state.rejected.push({
      cycle_id: manifest.cycle_id ?? event.cycle_id,
      rationale: manifest.curation?.rationale ?? 'No accepted candidate.',
      best_score: manifest.curation?.score ?? null
    });
  }
}

function completedManifest(events, cycleId) {
  return events.find((event) => event.type === 'cycle_completed' && event.cycle_id === cycleId)?.payload;
}

function applyHumanReview(state, event, events) {
  const review = event.payload.review ?? event.payload;
  const manifest = completedManifest(events, event.cycle_id);
  state.audience_findings.push({
    review_id: review.review_id,
    cycle_id: event.cycle_id,
    operation_id: event.payload.operation_id ?? review.operation_id ?? null,
    predicted_first_notice: manifest?.audience_prediction?.first_notice ?? null,
    actual_first_notice: review.answers?.first_notice ?? null,
    likely_misreading: manifest?.audience_prediction?.likely_misreading ?? null,
    too_explained: review.answers?.too_explained ?? null,
    ratings: review.ratings ?? null
  });
}

export function projectLedger(events) {
  const state = structuredClone(INITIAL_STATE);
  const cycles = new Map();

  for (const event of events) {
    if (event.cycle_id) {
      const cycleEvents = cycles.get(event.cycle_id) ?? [];
      cycleEvents.push(event);
      cycles.set(event.cycle_id, cycleEvents);
    }
    if (event.type === 'cycle_completed') {
      applyCompletedCycle(state, event, cycles.get(event.cycle_id) ?? []);
    } else if (event.type === 'human_review_recorded') {
      applyHumanReview(state, event, events);
    } else if (event.type === 'memory_corrected') {
      state.corrections.push({ correction_event_id: event.event_id, ...event.payload });
    } else if (event.type === 'studio_forked') {
      state.branch = event.payload;
    }
  }

  state.incomplete_cycles = [...cycles.entries()]
    .filter(([, cycleEvents]) =>
      cycleEvents.some((event) => event.type === 'cycle_started') &&
      !cycleEvents.some((event) => ['cycle_completed', 'cycle_failed'].includes(event.type))
    )
    .map(([cycleId, cycleEvents]) => ({
      cycle_id: cycleId,
      operation_id: cycleEvents.find((event) => event.type === 'cycle_started')?.payload?.operation_id ?? null,
      last_event_type: cycleEvents.at(-1).type,
      last_event_id: cycleEvents.at(-1).event_id
    }));
  state.ledger_head = headIdentity(events.at(-1));
  return state;
}
