import type {
  JourneyRankingPreference,
  TransferPace,
} from "./journey-search-preferences";

export interface JourneySearchRequest {
  serviceDate: string;
  originStation: string;
  destinationStation: string;
  departureTimeMinutes: number;
  arrivalTimeLimitMinutes?: number;
  limit?: number;
  maxTransfers?: 0 | 1 | 2 | 3;
  transferPace?: TransferPace;
  rankingPreference?: JourneyRankingPreference;
  excludedServiceTypes?: string[];
  excludedTrainNames?: string[];
  excludedTrainNumbers?: string[];
  excludedServiceUids?: string[];
  requiredServiceTypes?: string[];
  requiredTrainNames?: string[];
  requiredTrainNumbers?: string[];
  allowedServiceTypes?: string[];
}

export interface JourneySearchMatch {
  serviceUid: string;
  trainNumber: string;
  serviceType: string;
  trainName: string;
  originStation: string;
  destinationStation: string;
  departureTimeMinutes: number;
  arrivalTimeMinutes: number;
  scheduledDepartureTimeMinutes: number;
  scheduledArrivalTimeMinutes: number;
  delayMinutes: number;
  delayStatus?: "observed" | "estimated";
  delaySampleCount?: number;
  delayBasis?: string;
  source: "transitforge";
  discoverySource: "timetable-graph" | "direct-service-index";
  sourceReference: string;
}

export interface JourneySearchLeg {
  serviceUid: string;
  trainNumber: string;
  serviceType: string;
  trainName: string;
  serviceDestination?: string;
  originStation: string;
  destinationStation: string;
  departureTimeMinutes: number;
  arrivalTimeMinutes: number;
  scheduledDepartureTimeMinutes: number;
  scheduledArrivalTimeMinutes: number;
  delayMinutes: number;
  delayStatus?: "observed" | "estimated";
  delaySampleCount?: number;
  delayBasis?: string;
  stops?: Array<{
    stationName: string;
    arrivalTimeMinutes?: number;
    departureTimeMinutes?: number;
  }>;
}

export interface JourneySearchResponse {
  serviceDate: string;
  originStation: string;
  destinationStation: string;
  searchTimeMinutes: number;
  totalMatchCount: number;
  transferPace?: TransferPace;
  rankingPreference?: JourneyRankingPreference;
  maxTransfers?: number;
  excludedServiceTypes?: string[];
  excludedTrainNames?: string[];
  excludedTrainNumbers?: string[];
  excludedServiceUids?: string[];
  requiredServiceTypes?: string[];
  requiredTrainNames?: string[];
  requiredTrainNumbers?: string[];
  allowedServiceTypes?: string[];
  matches: JourneySearchMatch[];
  journeys: Array<{
    departureTimeMinutes: number;
    arrivalTimeMinutes: number;
    transferCount: number;
    legs: JourneySearchLeg[];
  }>;
}

export interface JourneySearchService {
  search(request: JourneySearchRequest): Promise<JourneySearchResponse>;
}
