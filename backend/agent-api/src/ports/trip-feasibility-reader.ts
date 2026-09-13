import type { Trip } from "@raiquora/trip/trip";
import type { TripFeasibilityFacts } from "@raiquora/trip/trip-feasibility";
import type { TripPrincipal } from "./trip-repository.js";

/** Read already acquired, owner-scoped facts for this exact proposed plan. No mandatory API pipeline. */
export interface TripFeasibilityReader {
  external(principal: TripPrincipal, proposed: Trip): Promise<TripFeasibilityFacts["external"]>;
}
