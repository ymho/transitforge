import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
export type ConsultationStartResult = { trip: Trip; conversationId: string } | { status: "out-of-scope"; message: string };

export interface TripMutationRequest { tripId: string; baseRevision: number; mutationId: string; proposal: TripUpdateProposal }
export interface PlanAdoptionTarget { conversationId: string; candidateSetId: string; candidateSetRevision: number; variantId: string; tripId: string; baseTripRevision: number; mutationId: string }
export interface PlanAdoptionPreview { confirmationKey: string; preview: { proposal: TripUpdateProposal; componentMap: readonly { componentId: string; itemId: string }[]; changes: { added: number; replaced: number; removed: number } } }
export interface TripAdoptionTarget { tripId: string; baseTripRevision: number; mutationId: string; action: "confirm" | "withdraw" }
export interface TripAdoptionPreview { confirmationKey: string; preview: { action: "confirm" | "withdraw"; summary: string; needsReconfirmation: boolean } }
export interface ItemDecisionTarget { tripId: string; itemId: string; baseTripRevision: number; mutationId: string; action: "confirm" | "withdraw" }
export interface ItemDecisionPreview { confirmationKey: string; preview: { itemId: string; title: string; action: "confirm" | "withdraw"; needsReconfirmation: boolean } }
/** A definitive rejection, unlike a lost response whose mutation may already have committed. */
export class TripWriteRejected extends Error {}

/** Transport operation port, not a second Domain Repository. Owner is resolved server-side. */
export interface ServerTripPage { trips: Trip[]; nextAfterTripId?: string }
export interface ServerTripClient {
  refreshWeather?(tripId: string, itemId: string, baseRevision: number, mutationId: string): Promise<Trip>;
  generateTitle?(tripId: string, baseRevision: number): Promise<string>;
  get(tripId: string): Promise<Trip | undefined>;
  sessionVersion?(): number;
  subscribeSessionChange?(listener: () => void): () => void;
  getRole?(tripId: string): import("@raiquora/trip/trip-sharing").TripRole | undefined;
  create(trip: Trip): Promise<Trip>;
  startConsultation?(input: { tripId: string; title: string; userRequest?: string }): Promise<ConsultationStartResult>;
  branchConsultation?(input: { sourceTripId: string; sourceRevision: number; tripId: string; title: string }): Promise<{ trip: Trip; conversationId: string; sourceTripId: string }>;
  list(page?: { limit?: number; afterTripId?: string }): Promise<ServerTripPage>;
  archive(tripId: string): Promise<void>;
  mutate(mutation: TripMutationRequest): Promise<Trip>;
  attach(conversationId: string, tripId: string): Promise<void>;
  detach(conversationId: string): Promise<void>;
  previewPlanAdoption?(target: PlanAdoptionTarget): Promise<PlanAdoptionPreview>;
  confirmPlanAdoption?(target: PlanAdoptionTarget, confirmationKey: string): Promise<Trip>;
  previewTripAdoption?(target: TripAdoptionTarget): Promise<TripAdoptionPreview>;
  confirmTripAdoption?(target: TripAdoptionTarget, confirmationKey: string): Promise<Trip>;
  previewItemDecision?(target: ItemDecisionTarget): Promise<ItemDecisionPreview>;
  confirmItemDecision?(target: ItemDecisionTarget, confirmationKey: string): Promise<Trip>;
}
export type TripLoadState = "loading" | "loaded" | "unavailable";
