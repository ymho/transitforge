import type { ConversationGuidance } from "./conversation-guidance";
import type {
  TripAccommodation,
} from "@raiquora/trip/travel-plan";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { WeatherForecast } from "@raiquora/trip/weather-forecast";
import type { PlaceMediaSearchResult } from "@raiquora/trip/place-media";
import type { WebPageReadResult, WebSearchResult } from "@raiquora/trip/web-research";
import type { HazardAlertSearchResult } from "@raiquora/trip/hazard-alert";
import type { GroundAccessArea, GroundAccessMatrix, GroundAccessRoute } from "@raiquora/trip/ground-access";
import type { RestaurantSearchResult } from "@raiquora/trip/restaurant-search";
import type { TripContext } from "@raiquora/trip/travel-profile";
import type { TripUpdateProposal } from "@raiquora/trip/trip";
import type { ChecklistProposal } from "@raiquora/trip/trip-checklist";
import type { PublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import type { PublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";

/** Domain compatibility for pure journey follow-up rules; it is not a Browser response contract. */
export type ViewerAgentJourneyPlan = import("@raiquora/trip/travel-plan").TripJourneyPlan;

export type ViewerAgentAccommodation = TripAccommodation;

export interface ViewerAgentExternalData {
  weather?: ExternalTravelInformation<WeatherForecast>;
  places?: ExternalTravelInformation<PlaceMediaSearchResult>;
  webSearch?: ExternalTravelInformation<WebSearchResult>;
  webPages?: ExternalTravelInformation<WebPageReadResult>;
  alerts?: ExternalTravelInformation<HazardAlertSearchResult>;
  groundAccess?: ExternalTravelInformation<GroundAccessRoute | GroundAccessMatrix | GroundAccessArea>;
  restaurants?: ExternalTravelInformation<RestaurantSearchResult>;
}
export interface ViewerAgentConversationResponse {
  text: string;
  conversation: ConversationGuidance;
  external?: ViewerAgentExternalData;
}
export interface ViewerAgentExternalResponse {
  text: string;
  external: ViewerAgentExternalData;
  tripContext?: TripContext;
}

export interface ViewerAgentContextResponse {
  text: string;
  tripContext: TripContext;
}

export interface ViewerAgentTurnResponse {
  text: string;
  semanticReceipt?: import("@raiquora/agent/public-semantic-receipt").PublicSemanticReceipt;
  publicPlanPresentation?: PublicPlanPresentation;
  publicJourneyPresentation?: PublicJourneyPresentation;
  tripCostProposal?: import("@raiquora/trip/public-cost-proposal").PublicCostProposal;
  consultationRequestProposal?: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal;
  tripUpdateProposal?: TripUpdateProposal;
}

export type ViewerAgentResponse =
  | ViewerAgentTurnResponse
  | { text: string; publicPlanPresentation: PublicPlanPresentation }
  | { text: string; tripCostProposal: import("@raiquora/trip/public-cost-proposal").PublicCostProposal }
  | { text: string; consultationRequestProposal: import("@raiquora/trip/consultation-request-proposal").ConsultationRequestProposal }
  | { text: string; checklistProposal: ChecklistProposal }
  | { text: string; tripUpdateProposal: TripUpdateProposal }
  | { text: string; progressSources: Array<{ url: string; evidenceId: string }> }
  | string
  | ViewerAgentConversationResponse
  | ViewerAgentExternalResponse
  | ViewerAgentContextResponse;
