import type { Trip } from "@raiquora/trip/trip";

/** Transport operation port, not a second Domain Repository. Owner is resolved server-side. */
export interface ServerTripClient {
  get(tripId: string): Promise<Trip | undefined>;
  create(trip: Trip): Promise<Trip>;
  attach(conversationId: string, tripId: string): Promise<void>;
  detach(conversationId: string): Promise<void>;
}
export type TripSourceState = "legacy-only" | "migration-pending" | "server-v2";
export type TripLoadState = "loading" | "loaded" | "unavailable";
