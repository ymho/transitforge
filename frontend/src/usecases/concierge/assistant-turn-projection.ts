import type { ViewerAgentResponse } from "../../domain/viewer-agent-response";

export interface PublicAssistantTurn {
  response: string;
  delivery?: NonNullable<import("@raiquora/agent/runtime-contract").AgentRuntimeResult["delivery"]>;
  semanticReceipt?: import("@raiquora/agent/public-semantic-receipt").PublicSemanticReceipt;
  publicPlanPresentation?: import("@raiquora/agent/public-plan-presentation").PublicPlanPresentation;
  publicJourneyPresentation?: import("@raiquora/agent/public-journey-presentation").PublicJourneyPresentation;
  publicPlacePresentation?: import("@raiquora/agent/public-place-presentation").PublicPlacePresentation;
  tripCostProposal?: import("@raiquora/trip/public-cost-proposal").PublicCostProposal;
  consultationRequestProposal?: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal;
  tripUpdateProposal?: import("@raiquora/trip/trip").TripUpdateProposal;
}

/** One projection for both live SSE and persisted history; accepts public artifacts only. */
export function projectAssistantTurn(turn: PublicAssistantTurn): ViewerAgentResponse {
  const artifacts = { ...(turn.delivery ? { delivery: turn.delivery } : {}), ...(turn.semanticReceipt ? { semanticReceipt: turn.semanticReceipt } : {}), ...(turn.publicPlanPresentation ? { publicPlanPresentation: turn.publicPlanPresentation } : {}), ...(turn.publicJourneyPresentation ? { publicJourneyPresentation: turn.publicJourneyPresentation } : {}),
    ...(turn.publicPlacePresentation ? { publicPlacePresentation: turn.publicPlacePresentation } : {}),
    ...(turn.tripCostProposal ? { tripCostProposal: turn.tripCostProposal } : {}), ...(turn.consultationRequestProposal ? { consultationRequestProposal: turn.consultationRequestProposal } : {}), ...(turn.tripUpdateProposal ? { tripUpdateProposal: turn.tripUpdateProposal } : {}) };
  return Object.keys(artifacts).length ? { text: turn.response, ...artifacts } : turn.response;
}
