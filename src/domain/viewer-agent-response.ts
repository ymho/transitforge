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
  journeys: JourneyRouteResult[];
}

export interface ViewerAgentRichResponse {
  text: string;
  journeyPlan: ViewerAgentJourneyPlan;
}

export type ViewerAgentResponse = string | ViewerAgentRichResponse;
