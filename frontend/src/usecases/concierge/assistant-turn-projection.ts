import type { AssistantTurnArtifacts, AssistantTurnView } from "../../domain/assistant-turn-view";

export interface PublicAssistantTurn extends AssistantTurnArtifacts {
  response: string;
}

/** One projection for both live SSE and persisted history; accepts public artifacts only. */
export function projectAssistantTurn(turn: PublicAssistantTurn): AssistantTurnView {
  return {
    text: turn.response,
    ...(turn.delivery ? { delivery: turn.delivery } : {}),
    ...(turn.tripMutationReceipt ? { tripMutationReceipt: turn.tripMutationReceipt } : {}),
    ...(turn.semanticReceipt ? { semanticReceipt: turn.semanticReceipt } : {}),
    ...(turn.publicPlanPresentation ? { publicPlanPresentation: turn.publicPlanPresentation } : {}),
    ...(turn.publicJourneyPresentation ? { publicJourneyPresentation: turn.publicJourneyPresentation } : {}),
    ...(turn.publicGroundRoutePresentation ? { publicGroundRoutePresentation: turn.publicGroundRoutePresentation } : {}),
    ...(turn.publicPlacePresentation ? { publicPlacePresentation: turn.publicPlacePresentation } : {}),
    ...(turn.publicAccommodationPresentation ? { publicAccommodationPresentation: turn.publicAccommodationPresentation } : {}),
    ...(turn.tripCostProposal ? { tripCostProposal: turn.tripCostProposal } : {}),
    ...(turn.consultationRequestProposal ? { consultationRequestProposal: turn.consultationRequestProposal } : {}),
    ...(turn.tripUpdateProposal ? { tripUpdateProposal: turn.tripUpdateProposal } : {}),
  };
}
