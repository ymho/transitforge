import type { TrustedPrincipal } from "../contracts/trusted-principal.js";

export interface ConversationTurnIdentity {
  principal: TrustedPrincipal;
  conversationId: string;
  turnId: string;
}
/** Only user-facing text and validated review proposals are replayable; Runtime traces/evidence are absent. */
export interface ConversationTurnResult { status: "completed" | "follow_up"; response: string; delivery?: NonNullable<import("@raiquora/agent/runtime-contract").AgentRuntimeResult["delivery"]>; semanticReceipt?: import("@raiquora/agent/public-semantic-receipt").PublicSemanticReceipt; publicPlanPresentation?: import("@raiquora/agent/public-plan-presentation").PublicPlanPresentation; publicJourneyPresentation?: import("@raiquora/agent/public-journey-presentation").PublicJourneyPresentation; publicPlacePresentation?: import("@raiquora/agent/public-place-presentation").PublicPlacePresentation; researchExecution?: import("@raiquora/agent/research-execution").ResearchExecutionOutcome; tripUpdateProposal?: import("@raiquora/trip/public-request-proposal").PublicRequestProposal; consultationRequestProposal?: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal; tripCostProposal?: import("@raiquora/trip/public-cost-proposal").PublicCostProposal; turnObservation?: import("@raiquora/agent/agent-turn-outcome").AgentTurnObservation; presentationReceipt?: import("@raiquora/agent/conversation-working-state").PresentationReceipt }
export interface ConversationTurnLease { attemptId: string; userSequence: number }
export interface ConversationTurnContinuity {
  /** Evidence IDs already validated into the public response/presentation. */
  publishedEvidenceIds: string[];
  evidence: import("@raiquora/agent/evidence-model").Evidence[];
}
export type BeginConversationTurn = { state: "started"; lease: ConversationTurnLease } |
  { state: "intent_accepted"; lease: ConversationTurnLease; receipt: import("@raiquora/agent/conversation-intent-reducer").IntentApplicationReceipt } |
  { state: "completed"; result: ConversationTurnResult };
export interface ConversationTurnRepository {
  beginTurn(identity: ConversationTurnIdentity, request: { userRequest: string; requestedResearchMode?: "standard" | "detailed"; researchTarget?: import("../contracts/server-state.js").ResearchTarget; tripId?: string; uiContext?: { itemId?: string; calendarDate?: string } }): Promise<BeginConversationTurn>;
  completeTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease, result: ConversationTurnResult, continuity?: ConversationTurnContinuity): Promise<ConversationTurnResult>;
  acceptIntent(identity: ConversationTurnIdentity, lease: ConversationTurnLease, delta: import("@raiquora/trip/conversation-intent").AcceptedIntentDelta): Promise<import("@raiquora/agent/conversation-intent-reducer").IntentApplicationReceipt>;
  failTurn(identity: ConversationTurnIdentity, lease: ConversationTurnLease): Promise<void>;
  getWorkingState(principal: TrustedPrincipal, conversationId: string): Promise<import("@raiquora/agent/conversation-working-state").ConversationWorkingState | undefined>;
}
