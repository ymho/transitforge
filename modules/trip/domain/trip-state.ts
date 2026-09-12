import type { Trip } from "./trip";

/** Position in planning, never a tool-selection or question-order policy. */
export type PlanningState = "inspiration" | "candidate_discovery" | "candidate_selection"
  | "itinerary_draft" | "itinerary_refinement" | "ready";
export type LifecycleState = "pre_trip" | "in_trip" | "completed" | "cancelled";

export function validatePlanningState(value: unknown): asserts value is PlanningState {
  if (!["inspiration", "candidate_discovery", "candidate_selection", "itinerary_draft", "itinerary_refinement", "ready"].includes(value as string)) {
    throw new Error("Invalid planning state");
  }
}
export function validateLifecycleState(value: unknown): asserts value is LifecycleState {
  if (!["pre_trip", "in_trip", "completed", "cancelled"].includes(value as string)) throw new Error("Invalid lifecycle state");
}

export function validateTripState(trip: Pick<Trip, "planningState" | "lifecycleState" | "items">): void {
  validatePlanningState(trip.planningState);
  validateLifecycleState(trip.lifecycleState);
  // #402 will supply the feasibility proof. No amount of items or model confidence is a substitute.
  if (trip.planningState === "ready") throw new Error("Ready certification requires #402 feasibility validation");
  if ((trip.planningState === "itinerary_draft" || trip.planningState === "itinerary_refinement" ||
      trip.lifecycleState === "in_trip" || trip.lifecycleState === "completed") && !trip.items.length) {
    throw new Error("Adopted itinerary items required for this state");
  }
}
