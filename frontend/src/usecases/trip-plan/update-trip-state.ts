import { applyTripProposal, validateTrip, type Trip, type TripUpdateProposal } from "@raiquora/trip/trip";
import type { PlanningState, LifecycleState } from "@raiquora/trip/trip-state";
import { assessTripTime, type TripClock } from "@raiquora/trip/trip-temporal";

/** AI or UI proposes a position; Domain validates the adopted items. No tool routing or storage. */
export function proposeTripPlanningState(trip: Trip, state: PlanningState): TripUpdateProposal {
  const proposal: TripUpdateProposal = { tripId: trip.id, summary: "旅行計画の状態を更新", patches: [{ type: "planning", state }] };
  applyTripProposal(trip, proposal);
  return proposal;
}

/** Real Clock is injected by composition. A proposal is not a persisted lifecycle update. */
export function proposeScheduledLifecycle(trip: Trip, clock: TripClock): TripUpdateProposal | undefined {
  validateTrip(trip);
  const assessment = assessTripTime(trip, clock);
  const state = assessment.suggestedLifecycle;
  if (!state || state === trip.lifecycleState) return undefined;
  return { tripId: trip.id, summary: "採用済み日程と実時間による旅行状態の更新",
    patches: [{ type: "lifecycle", state, basis: "schedule" }] };
}

/** Confirmation must be a UI/user action, not an Agent-provided actor flag. No production writer. */
export function confirmTripLifecycle(trip: Trip, confirmedState: LifecycleState): Trip {
  return applyTripProposal(trip, { tripId: trip.id, summary: "利用者が旅行状態を確認",
    patches: [{ type: "lifecycle", state: confirmedState, basis: "user_confirmation" }] },
  { confirmedLifecycle: confirmedState });
}
