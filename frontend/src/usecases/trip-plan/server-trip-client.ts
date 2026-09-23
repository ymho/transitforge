import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";

export interface TripMutationRequest { tripId: string; baseRevision: number; mutationId: string; proposal: TripUpdateProposal }
export interface PlanAdoptionTarget { conversationId: string; candidateSetId: string; candidateSetRevision: number; variantId: string; tripId: string; baseTripRevision: number; mutationId: string }
export interface PlanAdoptionPreview { confirmationKey: string; preview: { proposal: TripUpdateProposal; componentMap: readonly { componentId: string; itemId: string }[]; changes: { added: number; replaced: number; removed: number } } }
/** A definitive rejection, unlike a lost response whose mutation may already have committed. */
export class TripWriteRejected extends Error {}

/** Transport operation port, not a second Domain Repository. Owner is resolved server-side. */
export interface ServerTripPage { trips: Trip[]; nextAfterTripId?: string }
export interface ServerTripClient {
  get(tripId: string): Promise<Trip | undefined>;
  sessionVersion?(): number;
  subscribeSessionChange?(listener: () => void): () => void;
  getRole?(tripId: string): import("@raiquora/trip/trip-sharing").TripRole | undefined;
  create(trip: Trip): Promise<Trip>;
  list(page?: { limit?: number; afterTripId?: string }): Promise<ServerTripPage>;
  archive(tripId: string): Promise<void>;
  mutate(mutation: TripMutationRequest): Promise<Trip>;
  attach(conversationId: string, tripId: string): Promise<void>;
  detach(conversationId: string): Promise<void>;
  previewPlanAdoption?(target: PlanAdoptionTarget): Promise<PlanAdoptionPreview>;
  confirmPlanAdoption?(target: PlanAdoptionTarget, confirmationKey: string): Promise<Trip>;
}
export type TripLoadState = "loading" | "loaded" | "unavailable";
