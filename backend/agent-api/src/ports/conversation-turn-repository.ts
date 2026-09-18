import type { TrustedPrincipal } from "../contracts/trusted-principal.js";

export interface ConversationTurnIdentity {
  principal: TrustedPrincipal;
  conversationId: string;
  turnId: string;
}
/** Only the user-facing text is replayable; Runtime traces/evidence are deliberately absent. */
export interface ConversationTurnResult { status: "completed" | "follow_up"; response: string }
export interface ConversationTurnLease { attemptId: string; userSequence: number }
export type BeginConversationTurn = { state: "started"; lease: ConversationTurnLease } |
  { state: "completed"; result: ConversationTurnResult };
export interface ConversationTurnRepository {
  beginTurn(identity: ConversationTurnIdentity, request: { userRequest: string; tripId?: string; uiContext?: { itemId?: string } }): Promise<BeginConversationTurn>;
  completeTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease, result: ConversationTurnResult): Promise<ConversationTurnResult>;
  failTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease): Promise<void>;
}
