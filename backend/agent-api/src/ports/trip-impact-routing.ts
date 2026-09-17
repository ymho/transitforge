import type { WatchSubject } from "@raiquora/trip/trip-watch";
import type { TripImpact } from "@raiquora/trip/trip-impact";
import type { Trip } from "@raiquora/trip/trip";
import type { TripPrincipal } from "./trip-repository.js";
import type { TravelEvent } from "@raiquora/trip/travel-event";

/** Trusted storage-derived principals only. Never accepts an owner list from an Event/public body. */
export interface TripImpactRouter {
  route(subject: WatchSubject): Promise<{
    routes: { principal: TripPrincipal; tripId: string }[]; stale: number;
  }>;
}
export interface TripImpactRepository {
  /** Atomically conditions the latest saved Trip with this separate resource write. */
  save(principal: TripPrincipal, trip: Trip, impact: TripImpact, observation?: TravelEvent): Promise<void>;
  read(principal: TripPrincipal, tripId: string, impactId: string): Promise<{
    impact: TripImpact; matchesTripRevision: boolean;
  } | undefined>;
}
