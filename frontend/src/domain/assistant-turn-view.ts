import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";

/** Public v2 artifacts only. Provider output and legacy conversation state never enter the view. */
export type AssistantTurnArtifacts = Pick<Extract<AgentTurnEvent, { type: "final" }>,
  "delivery" | "tripMutationReceipt" | "semanticReceipt" | "publicPlanPresentation" |
  "publicJourneyPresentation" | "publicGroundRoutePresentation" | "publicPlacePresentation" |
  "publicAccommodationPresentation" | "tripCostProposal" | "consultationRequestProposal" | "tripUpdateProposal">;

/** One stable shape for live replies, history, replay and local notices. */
export interface AssistantTurnView extends AssistantTurnArtifacts {
  text: string;
}
