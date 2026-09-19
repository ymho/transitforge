import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";

export interface TripMutationRequest { tripId: string; baseRevision: number; mutationId: string; proposal: TripUpdateProposal }
/** A definitive rejection, unlike a lost response whose mutation may already have committed. */
export class TripWriteRejected extends Error {}

/** Transport operation port, not a second Domain Repository. Owner is resolved server-side. */
export interface ServerTripClient {
  get(tripId: string): Promise<Trip | undefined>;
  sessionVersion?(): number;
  subscribeSessionChange?(listener: () => void): () => void;
  getRole?(tripId: string): import("@raiquora/trip/trip-sharing").TripRole | undefined;
  create(trip: Trip): Promise<Trip>;
  attach(conversationId: string, tripId: string): Promise<void>;
  detach(conversationId: string): Promise<void>;
}
export type TripLoadState = "loading" | "loaded" | "unavailable";
