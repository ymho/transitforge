import type { JourneyRouteResult } from "./direct-route-search";
import type {
  JourneyRankingPreference,
  TransferPace,
} from "./journey-search-preferences";

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

export type ViewerAgentResponse =
  | string
  | ViewerAgentRichResponse
  | ViewerAgentTravelResponse;
