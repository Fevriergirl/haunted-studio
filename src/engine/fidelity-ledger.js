// Persistence adapter between the pure fidelity-adjudication records and the
// append-only studio ledger. Fidelity adjudication is a post-hoc audit of a
// completed cycle's artifact, so its events are post-cycle events that require
// a `cycle_completed` terminal (enforced by the event contract).
//
// This adapter only maps records <-> event specs and reconstructs records for
// `deriveAdjudication`. It does not call providers or run the cycle; that is a
// later increment.

const FIDELITY_ACTOR = 'role:fidelity-adjudicator';

export function fidelityIntentionFrozenEvent(frozen, cycleId) {
  return { type: 'fidelity_intention_frozen', actor: FIDELITY_ACTOR, cycleId, payload: frozen };
}

export function fidelityMakerReportedEvent(report, cycleId) {
  return { type: 'fidelity_maker_reported', actor: FIDELITY_ACTOR, cycleId, payload: report };
}

export function fidelitySignalsDetectedEvent(signals, cycleId, frozen) {
  return {
    type: 'fidelity_signals_detected',
    actor: 'role:fidelity-detector',
    cycleId,
    payload: { commitment_hash: frozen.commitment_hash, signals }
  };
}

export function fidelityViolationsAllegedEvent(possibleViolations, cycleId, frozen) {
  return {
    type: 'fidelity_violation_alleged',
    actor: 'role:fidelity-detector',
    cycleId,
    payload: { commitment_hash: frozen.commitment_hash, possible_violations: possibleViolations }
  };
}

export function fidelityAdjudicatedEvent(verdict, cycleId) {
  return { type: 'fidelity_adjudicated', actor: 'role:fidelity-adversarial-reviewer', cycleId, payload: verdict };
}

export function fidelityCanonRevokedEvent(payload, cycleId) {
  return { type: 'canon_revoked_by_fidelity', actor: 'role:fidelity-adjudicator', cycleId, payload };
}

// Reconstruct the flat record list (for deriveAdjudication) from a cycle's
// persisted fidelity events, preserving append order.
export function fidelityRecordsFromEvents(events, cycleId) {
  const records = [];
  for (const event of events) {
    if (event.cycle_id !== cycleId) continue;
    switch (event.type) {
      case 'fidelity_intention_frozen':
      case 'fidelity_maker_reported':
        records.push(event.payload);
        break;
      case 'fidelity_signals_detected':
        records.push(...event.payload.signals);
        break;
      case 'fidelity_violation_alleged':
        records.push(...event.payload.possible_violations);
        break;
      case 'fidelity_adjudicated':
        records.push(event.payload);
        break;
      default:
        break;
    }
  }
  return records;
}
