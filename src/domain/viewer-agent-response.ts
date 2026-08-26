import type { ConversationGuidance } from "./conversation-guidance";
import type { TripPlanUpdateProposal } from "@raiquora/trip/trip-plan";
import type {
  TravelPlan,
  TripAccommodation,
  TripJourneyPlan,
} from "@raiquora/trip/travel-plan";

export type ViewerAgentJourneyPlan = TripJourneyPlan;

export interface ViewerAgentRichResponse {
  text: string;
  journeyPlan: ViewerAgentJourneyPlan;
}

export type ViewerAgentAccommodation = TripAccommodation;
export type ViewerAgentTravelPlan = TravelPlan;

export interface ViewerAgentTravelResponse {
  text: string;
  travelPlan: ViewerAgentTravelPlan;
}

export interface ViewerAgentConversationResponse {
  text: string;
  conversation: ConversationGuidance;
}
export interface ViewerAgentTripPlanUpdateResponse { text: string; tripPlanUpdate: TripPlanUpdateProposal; }

export type ViewerAgentResponse =
  | string
  | ViewerAgentRichResponse
  | ViewerAgentTravelResponse
  | ViewerAgentConversationResponse
  | ViewerAgentTripPlanUpdateResponse;
