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
export interface DailyCongestionPeak {
  collectedAt: string;
  sourceUpdatedAt: string;
  totalCongestion: number;
  trainCount: number;
  carCount: number;
  topTrains: Array<{ trainNumber: string; totalCongestion: number }>;
}
export interface DailyCongestionPeakResponse {
  serviceDate: string;
  sampleCount: number;
  peak: DailyCongestionPeak | null;
}
export interface TrainCongestionStat {
  trainNumber: string;
  observedSampleCount: number;
  averageCongestion: number;
  dailyAverageContribution: number;
  peakCongestion: number;
  peakCollectedAt: string;
}
export interface HourlyCongestionAnalysis {
  hourJst: number;
  sampleCount: number;
  averageTotalCongestion: number | null;
  peakTotalCongestion: number | null;
  peakCollectedAt: string | null;
  averageTrainCount: number | null;
  topTrain: TrainCongestionStat | null;
}
export interface DailyCongestionAnalysisResponse {
  serviceDate: string;
  sampleCount: number;
  observationStart: string | null;
  observationEnd: string | null;
  peak: DailyCongestionPeak | null;
  hourly: HourlyCongestionAnalysis[];
  trainStats: TrainCongestionStat[];
}
export interface TrainDelaySnapshotAnalysis {
  collectedAt: string;
  sourceCount: number;
  failureCount: number;
  observedTrainCount: number;
  delayedTrainCount: number;
  totalDelayMinutes: number;
  maximumDelayMinutes: number;
  topTrains: Array<{ trainNumber: string; delayMinutes: number }>;
}
export interface HourlyTrainDelayAnalysis {
  hourJst: number;
  sampleCount: number;
  averageDelayedTrainCount: number | null;
  peakDelayedTrainCount: number | null;
  peakTotalDelayMinutes: number | null;
  maximumDelayMinutes: number | null;
  peakCollectedAt: string | null;
}
export interface TrainDelayStat {
  trainNumber: string;
  delayedSampleCount: number;
  averageDelayWhenDelayed: number;
  dailyAverageDelayContribution: number;
  peakDelayMinutes: number;
  peakCollectedAt: string;
}
export interface TrainDelayAnalysisResponse {
  serviceDate: string;
  sampleCount: number;
  observationStart: string | null;
  observationEnd: string | null;
  latest: TrainDelaySnapshotAnalysis | null;
  peak: TrainDelaySnapshotAnalysis | null;
  hourly: HourlyTrainDelayAnalysis[];
  trainStats: TrainDelayStat[];
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
} from "../domain/journey-search-service";
