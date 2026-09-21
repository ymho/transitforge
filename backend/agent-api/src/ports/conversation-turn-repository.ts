import type { TrustedPrincipal } from "../contracts/trusted-principal.js";

export interface ConversationTurnIdentity {
  principal: TrustedPrincipal;
  conversationId: string;
  turnId: string;
}
/** Only user-facing text and validated review proposals are replayable; Runtime traces/evidence are absent. */
export interface ConversationTurnResult { status: "completed" | "follow_up"; response: string; tripUpdateProposal?: import("@raiquora/trip/public-request-proposal").PublicRequestProposal; consultationRequestProposal?: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal; tripCostProposal?: import("@raiquora/trip/public-cost-proposal").PublicCostProposal }
export interface ConversationTurnLease { attemptId: string; userSequence: number }
export type BeginConversationTurn = { state: "started"; lease: ConversationTurnLease } |
  { state: "completed"; result: ConversationTurnResult };
export interface ConversationTurnRepository {
  beginTurn(identity: ConversationTurnIdentity, request: { userRequest: string; tripId?: string; uiContext?: { itemId?: string } }): Promise<BeginConversationTurn>;
  completeTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease, result: ConversationTurnResult): Promise<ConversationTurnResult>;
  failTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease): Promise<void>;
}
