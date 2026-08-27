import type { ConversationGuidance } from "./conversation-guidance";
import type { TripPlanUpdateProposal } from "@raiquora/trip/trip-plan";
import type {
  TravelPlan,
  TripAccommodation,
  TripJourneyPlan,
} from "@raiquora/trip/travel-plan";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { WeatherForecast } from "@raiquora/trip/weather-forecast";
import type { PlaceMediaSearchResult } from "@raiquora/trip/place-media";
import type { FlightSearchResult } from "@raiquora/trip/flight-search";

export type ViewerAgentJourneyPlan = TripJourneyPlan;

export interface ViewerAgentRichResponse {
  text: string;
  journeyPlan: ViewerAgentJourneyPlan;
}

export type ViewerAgentAccommodation = TripAccommodation;
export type ViewerAgentTravelPlan = TravelPlan;

export interface ViewerAgentExternalData {
  weather?: ExternalTravelInformation<WeatherForecast>;
  places?: ExternalTravelInformation<PlaceMediaSearchResult>;
  flights?: ExternalTravelInformation<FlightSearchResult>;
}
export interface ViewerAgentTravelResponse {
  text: string;
  travelPlan: ViewerAgentTravelPlan;
  external?: ViewerAgentExternalData;
}

export interface ViewerAgentConversationResponse {
  text: string;
  conversation: ConversationGuidance;
}
export interface ViewerAgentTripPlanUpdateResponse { text: string; tripPlanUpdate: TripPlanUpdateProposal; }
export interface ViewerAgentExternalResponse {
  text: string;
  external: ViewerAgentExternalData;
}

export type ViewerAgentResponse =
  | string
  | ViewerAgentRichResponse
  | ViewerAgentTravelResponse
  | ViewerAgentConversationResponse
  | ViewerAgentTripPlanUpdateResponse
  | ViewerAgentExternalResponse;
