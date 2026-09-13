import type { StoredTripWatch, WatchSubject } from "@raiquora/trip/trip-watch";
import type { Trip } from "@raiquora/trip/trip";
import type { TripPrincipal } from "./trip-repository.js";

export interface TripWatchRead {
  readonly version: number;
  readonly complete: boolean;
  readonly sourceTripRevision?: number;
  readonly records: readonly StoredTripWatch[];
}
export interface TripWatchRepository {
  read(principal: TripPrincipal, tripId: string): Promise<TripWatchRead>;
  /** Complete owner + exact subject lookup. The Adapter verifies eventual index hits on the base table. */
  find(principal: TripPrincipal, subject: WatchSubject): Promise<StoredTripWatch[]>;
  /** Guards saved Trip state AND collection version, without writing/rolling back Trip. */
  commit(principal: TripPrincipal, tripId: string, base: TripWatchRead, trip: Trip | undefined,
    writes: readonly StoredTripWatch[]): Promise<void>;
}
