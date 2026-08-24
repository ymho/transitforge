import type { JourneyRouteResult } from "./direct-route-search";
import type {
  JourneyRankingPreference,
  TransferPace,
} from "./journey-search-preferences";
import type { ConversationGuidance } from "./conversation-guidance";
import type { TripPlanUpdateProposal } from "./trip-plan";

export interface ViewerAgentJourneyPlan {
  departureDate?: string;
  serviceDate?: string;
  originStation: string;
  destinationStation: string;
  transferPace?: TransferPace;
  rankingPreference?: JourneyRankingPreference;
  maxTransfers?: number;
  searchTimeMinutes?: number;
  excludedServiceTypes?: string[];
  excludedTrainNames?: string[];
  excludedTrainNumbers?: string[];
  excludedServiceUids?: string[];
  requiredServiceTypes?: string[];
  requiredTrainNames?: string[];
  requiredTrainNumbers?: string[];
  allowedServiceTypes?: string[];
  journeys: JourneyRouteResult[];
}

export interface ViewerAgentRichResponse {
  text: string;
  journeyPlan: ViewerAgentJourneyPlan;
}

export interface ViewerAgentAccommodation {
  name: string;
  checkInDate: string;
  checkOutDate: string;
  bookingUrl?: string;
  areaName?: string;
  imageUrl?: string;
}

export interface ViewerAgentTravelPlan {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  outbound: ViewerAgentJourneyPlan;
  returning: ViewerAgentJourneyPlan;
  accommodations: ViewerAgentAccommodation[];
}

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
