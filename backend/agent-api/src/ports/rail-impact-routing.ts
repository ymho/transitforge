import type { WatchSubject } from "@raiquora/trip/trip-watch";
import type { TripImpact } from "@raiquora/trip/trip-impact";
import type { Trip } from "@raiquora/trip/trip";
import type { TripPrincipal } from "./trip-repository.js";

/** Trusted storage-derived principals only. Never accepts an owner list from an Event/public body. */
export interface RailImpactRouter {
  route(subject: Extract<WatchSubject, { type: "rail-service" }>): Promise<{
    routes: { principal: TripPrincipal; tripId: string }[]; stale: number;
  }>;
}
export interface TripImpactRepository {
  /** Atomically conditions the latest saved Trip with this separate resource write. */
  save(principal: TripPrincipal, trip: Trip, impact: TripImpact): Promise<void>;
  read(principal: TripPrincipal, tripId: string, impactId: string): Promise<{
    impact: TripImpact; matchesTripRevision: boolean;
  } | undefined>;
}
