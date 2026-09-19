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
    address?: string;
    latitude?: number;
    longitude?: number;
    reviewAverage?: number;
    reviewCount?: number;
    price?: import("@raiquora/trip/money").PriceObservation;
    availability?: "available" | "unknown";
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
export interface HazardAlertSearchResponse {
  alerts: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    import("@raiquora/trip/hazard-alert").HazardAlertSearchResult
  >;
}
export interface GroundAccessSearchResponse {
  groundAccess: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    | import("@raiquora/trip/ground-access").GroundAccessRoute
    | import("@raiquora/trip/ground-access").GroundAccessMatrix
    | import("@raiquora/trip/ground-access").GroundAccessArea
  >;
}
export interface RestaurantSearchResponse {
  restaurants: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    import("@raiquora/trip/restaurant-search").RestaurantSearchResult
  >;
}
export interface WebSearchResponse {
  webSearch: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    import("@raiquora/trip/web-research").WebSearchResult
  >;
}
export interface WebPageReadResponse {
  webPages: import("@raiquora/trip/external-travel-information").ExternalTravelInformation<
    import("@raiquora/trip/web-research").WebPageReadResult
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
