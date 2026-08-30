export interface BedrockAgentTextBlock { text: string; }
export interface BedrockAgentToolUseBlock {
  toolUse: { toolUseId: string; name: string; input: Record<string, unknown> };
}
export interface BedrockAgentToolResultBlock {
  toolResult: {
    toolUseId: string;
    status: "success" | "error";
    content: [{ json: unknown }];
  };
}
export type BedrockAgentContentBlock =
  | BedrockAgentTextBlock
  | BedrockAgentToolUseBlock
  | BedrockAgentToolResultBlock;
export interface BedrockAgentMessage {
  role: "assistant" | "user";
  content: BedrockAgentContentBlock[];
}
export interface BedrockAgentResponse {
  message: BedrockAgentMessage;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  metadata?: {
    modelId?: string;
    latencyMs?: number;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };
}
export interface AccommodationSearchResponse {
  accommodations: Array<{
    kind: "accommodation";
    provider: string;
    providerItemId: string;
    name: string;
    checkInDate: string;
    checkOutDate: string;
    bookingUrl?: string;
    areaName?: string;
    imageUrl?: string;
  }>;
}
export interface WeatherForecastSearchResponse {
  forecast: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    import("@raiquora/trip/weather-forecast").WeatherForecast
  >;
}
export interface WeatherGridSearchResponse {
  weatherGrid: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    import("@raiquora/trip/weather-grid").WeatherGridSnapshot
  >;
}
export interface PlaceMediaSearchResponse {
  result: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    import("@raiquora/trip/place-media").PlaceMediaSearchResult
  >;
}
export interface FlightSearchResponse {
  flights: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    import("@raiquora/trip/flight-search").FlightSearchResult
  >;
}
export type RepresentativeTimetableKind = "weekday" | "weekend_holiday";
export type RepresentativeTimetableSearchMode =
  | "active"
  | "arrivals"
  | "departures";
export interface RepresentativeTimetableSearchResponse {
  timetableKind: RepresentativeTimetableKind;
  serviceDate: string;
  mode: RepresentativeTimetableSearchMode;
  targetTimeMinutes: number | null;
  totalMatchCount: number;
  matches: Array<{
    trainNumber: string;
    serviceType: string;
    trainName: string;
    origin: string;
    destination: string;
    matchingStops: Array<{
      stationName: string;
      event: string;
      routeTimeMinutes: number;
    }>;
  }>;
}

export type {
  JourneySearchResponse as TravelCandidateSearchResponse,
} from "@raiquora/journey/journey-search-service";
export type {
  DailyCongestionAnalysisResponse,
  DailyCongestionPeak,
  DailyCongestionPeakResponse,
  HourlyCongestionAnalysis,
  HourlyTrainDelayAnalysis,
  TrainCongestionStat,
  TrainDelayAnalysisResponse,
  TrainDelaySnapshotAnalysis,
  TrainDelayStat,
} from "@raiquora/operation/analysis";
