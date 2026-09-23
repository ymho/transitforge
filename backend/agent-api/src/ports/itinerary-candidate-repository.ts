import type { ItineraryCandidateSet } from "@raiquora/trip/itinerary-candidates";
import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import type { TripPrincipal } from "./trip-repository.js";

/** Owner and conversation are part of the lookup key. There is no global candidate lookup. */
export interface ItineraryCandidateRepository {
  put(principal: TripPrincipal, candidateSet: ItineraryCandidateSet): Promise<void>;
  get(principal: TripPrincipal, conversationId: string, candidateSetId: string, revision: number): Promise<ItineraryCandidateSet | undefined>;
}

export interface CandidateAdoptionPreviewReceipt {
  mutationId: string;
  conversationId: string;
  candidateSetId: string;
  candidateSetRevision: number;
  variantId: string;
  tripId: string;
  baseTripRevision: number;
  confirmationKey: string;
  proposal: TripUpdateProposal;
  componentMap: readonly { componentId: string; itemId: string }[];
}
export interface CandidateAdoptionReceiptRepository {
  putPreview(principal: TripPrincipal, receipt: CandidateAdoptionPreviewReceipt): Promise<CandidateAdoptionPreviewReceipt>;
  getPreview(principal: TripPrincipal, conversationId: string, mutationId: string): Promise<CandidateAdoptionPreviewReceipt | undefined>;
}

/** Cross-table cleanup boundary used only after the Conversation has been tombstoned. */
export interface ConversationCandidateResourceRepository {
  purgeConversation(principal: TripPrincipal, conversationId: string): Promise<{ complete: boolean }>;
}
export type CandidateAdoptionResult =
  | { status: "confirmation-required"; confirmationKey: string; preview: { proposal: TripUpdateProposal; componentMap: readonly { componentId: string; itemId: string }[]; changes: { added: number; replaced: number; removed: number } } }
  | { status: "saved"; trip: Trip; revision: number; mutationId: string };
