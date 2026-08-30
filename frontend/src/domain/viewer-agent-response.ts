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
import type { WebPageReadResult, WebSearchResult } from "@raiquora/trip/web-research";
import type { TravelAlertSearchResult } from "@raiquora/trip/travel-alert";
import type { GroundAccessArea, GroundAccessMatrix, GroundAccessRoute } from "@raiquora/trip/ground-access";
import type { RestaurantSearchResult } from "@raiquora/trip/restaurant-search";

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
  webSearch?: ExternalTravelInformation<WebSearchResult>;
  webPages?: ExternalTravelInformation<WebPageReadResult>;
  alerts?: ExternalTravelInformation<TravelAlertSearchResult>;
  groundAccess?: ExternalTravelInformation<GroundAccessRoute | GroundAccessMatrix | GroundAccessArea>;
  restaurants?: ExternalTravelInformation<RestaurantSearchResult>;
}
export interface ViewerAgentTravelResponse {
  text: string;
  travelPlan: ViewerAgentTravelPlan;
  external?: ViewerAgentExternalData;
}

export interface ViewerAgentConversationResponse {
  text: string;
  conversation: ConversationGuidance;
  external?: ViewerAgentExternalData;
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
