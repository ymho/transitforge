import type { Trip } from "@raiquora/trip/trip";
import type { TripWatch, ResolvedWatchScope } from "@raiquora/trip/trip-watch";
import type { TravelEvent } from "@raiquora/trip/travel-event";
import type { TripImpact } from "@raiquora/trip/trip-impact";
import type { ReservationFact } from "@raiquora/trip/reservation";
import type { TripPrincipal } from "./trip-repository.js";

/** #394/#408 implement deterministic impact evaluation. No default severity/LLM evaluator. */
export interface TripImpactEvaluator {
  evaluate(input: { trip: Trip; event: TravelEvent; watches: readonly TripWatch[];
    reservations: readonly ReservationFact[]; evaluatedAt: string }): Promise<TripImpact>;
}
export interface WatchScopeResolver {
  resolve(principal: TripPrincipal, trip: Trip): Promise<readonly ResolvedWatchScope[]>;
}
/** Read-only, private booking fields excluded by the existing ReservationFact projection. */
export interface WatchReservationReader {
  facts(principal: TripPrincipal, tripId: string): Promise<ReservationFact[]>;
}
