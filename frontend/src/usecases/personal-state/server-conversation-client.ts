export type ServerConversationScope = "trip";
export interface ServerConversationMetadata { title: string; scope: ServerConversationScope; summary: string; resolvedTopics: string[]; pendingTopics: string[]; tripId: string }
export interface ServerConversation extends ServerConversationMetadata { conversationId: string; createdAt: string; updatedAt: string; revision: number; messageCount: number }
export interface ServerConversationMessage { role: "user" | "assistant"; text: string; sequence: number; createdAt: string; delivery?: NonNullable<import("@raiquora/agent/runtime-contract").AgentRuntimeResult["delivery"]>; tripMutationReceipt?: import("@raiquora/agent/public-trip-mutation-receipt").PublicTripMutationReceipt; semanticReceipt?: import("@raiquora/agent/public-semantic-receipt").PublicSemanticReceipt; publicPlanPresentation?: import("@raiquora/agent/public-plan-presentation").PublicPlanPresentation; publicJourneyPresentation?: import("@raiquora/agent/public-journey-presentation").PublicJourneyPresentation; publicGroundRoutePresentation?: import("@raiquora/agent/public-ground-route-presentation").PublicGroundRoutePresentation; publicPlacePresentation?: import("@raiquora/agent/public-place-presentation").PublicPlacePresentation; publicAccommodationPresentation?: import("@raiquora/agent/public-accommodation-presentation").PublicAccommodationPresentation; tripUpdateProposal?: import("@raiquora/trip/trip").TripUpdateProposal; consultationRequestProposal?: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal; tripCostProposal?: import("@raiquora/trip/public-cost-proposal").PublicCostProposal }
export interface ServerPage<T> { items: T[]; nextAfter?: string }
/** Authenticated transport port. It deliberately does not replace the legacy browser repositories yet. */
export interface ServerConversationClient {
  create(metadata: ServerConversationMetadata): Promise<ServerConversation>;
  get(conversationId: string): Promise<ServerConversation | undefined>;
  list(page?: { limit?: number; after?: string }): Promise<ServerPage<ServerConversation>>;
  history(conversationId: string, page?: { limit?: number; after?: string }): Promise<ServerPage<ServerConversationMessage>>;
  update(conversationId: string, expectedRevision: number, metadata: ServerConversationMetadata): Promise<ServerConversation>;
  delete(conversationId: string, expectedRevision: number): Promise<{ complete: boolean }>;
}
