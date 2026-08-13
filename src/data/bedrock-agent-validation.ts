import type {
  BedrockAgentContentBlock,
  BedrockAgentMessage,
  BedrockAgentResponse,
  DailyCongestionAnalysisResponse,
  DailyCongestionPeak,
  DailyCongestionPeakResponse,
  HourlyCongestionAnalysis,
  HourlyTrainDelayAnalysis,
  RepresentativeTimetableSearchResponse,
  TrainCongestionStat,
  TrainDelayAnalysisResponse,
  TrainDelaySnapshotAnalysis,
  TrainDelayStat,
  TravelCandidateSearchResponse,
} from "./bedrock-agent-contract";

export function isBedrockAgentResponse(value: unknown): value is BedrockAgentResponse {
  return isRecord(value) && ["end_turn", "tool_use", "max_tokens"].includes(String(value.stopReason)) &&
    isMessage(value.message) && value.message.role === "assistant";
}

export function isDailyCongestionPeakResponse(value: unknown): value is DailyCongestionPeakResponse {
  return isRecord(value) && typeof value.serviceDate === "string" &&
    isNonNegativeInteger(value.sampleCount) &&
    (value.peak === null || isDailyCongestionPeak(value.peak));
}

export function isDailyCongestionAnalysisResponse(value: unknown): value is DailyCongestionAnalysisResponse {
  return isRecord(value) && typeof value.serviceDate === "string" &&
    isNonNegativeInteger(value.sampleCount) && isNullableString(value.observationStart) &&
    isNullableString(value.observationEnd) &&
    (value.peak === null || isDailyCongestionPeak(value.peak)) &&
    Array.isArray(value.hourly) && value.hourly.length === 24 &&
    value.hourly.every(isHourlyCongestionAnalysis) &&
    Array.isArray(value.trainStats) && value.trainStats.every(isTrainCongestionStat);
}

export function isTrainDelayAnalysisResponse(value: unknown): value is TrainDelayAnalysisResponse {
  return isRecord(value) && typeof value.serviceDate === "string" &&
    isNonNegativeInteger(value.sampleCount) && isNullableString(value.observationStart) &&
    isNullableString(value.observationEnd) &&
    (value.latest === null || isTrainDelaySnapshotAnalysis(value.latest)) &&
    (value.peak === null || isTrainDelaySnapshotAnalysis(value.peak)) &&
    Array.isArray(value.hourly) && value.hourly.length === 24 &&
    value.hourly.every(isHourlyTrainDelayAnalysis) &&
    Array.isArray(value.trainStats) && value.trainStats.every(isTrainDelayStat);
}

export function isRepresentativeTimetableSearchResponse(value: unknown): value is RepresentativeTimetableSearchResponse {
  return isRecord(value) && ["weekday", "weekend_holiday"].includes(String(value.timetableKind)) &&
    typeof value.serviceDate === "string" && ["active", "arrivals", "departures"].includes(String(value.mode)) &&
    (value.targetTimeMinutes === null || isNonNegativeNumber(value.targetTimeMinutes)) &&
    isNonNegativeInteger(value.totalMatchCount) && Array.isArray(value.matches) &&
    value.matches.length <= 5 && value.matches.every((match) =>
      isRecord(match) && typeof match.trainNumber === "string" && typeof match.serviceType === "string" &&
      typeof match.trainName === "string" && typeof match.origin === "string" &&
      typeof match.destination === "string" && Array.isArray(match.matchingStops) &&
      match.matchingStops.every((stop) => isRecord(stop) && typeof stop.stationName === "string" &&
        typeof stop.event === "string" && isNonNegativeNumber(stop.routeTimeMinutes)));
}

export function isTravelCandidateSearchResponse(value: unknown): value is TravelCandidateSearchResponse {
  return isRecord(value) && typeof value.serviceDate === "string" &&
    typeof value.originStation === "string" && typeof value.destinationStation === "string" &&
    isNonNegativeNumber(value.searchTimeMinutes) && isNonNegativeInteger(value.totalMatchCount) &&
    Array.isArray(value.matches) && value.matches.length <= 5 && value.matches.every((match) =>
      isRecord(match) && typeof match.serviceUid === "string" &&
      typeof match.trainNumber === "string" && typeof match.serviceType === "string" &&
      typeof match.trainName === "string" && typeof match.originStation === "string" &&
      typeof match.destinationStation === "string" &&
      isNonNegativeNumber(match.departureTimeMinutes) &&
      isNonNegativeNumber(match.arrivalTimeMinutes) &&
      isNonNegativeNumber(match.scheduledDepartureTimeMinutes) &&
      isNonNegativeNumber(match.scheduledArrivalTimeMinutes) &&
      isNonNegativeNumber(match.delayMinutes) && match.source === "transitforge" &&
      match.discoverySource === "timetable-graph" && typeof match.sourceReference === "string") &&
    Array.isArray(value.journeys) && value.journeys.length <= 5 &&
    value.journeys.every(isJourney);
}

function isJourney(value: unknown): boolean {
  return isRecord(value) && isNonNegativeNumber(value.departureTimeMinutes) &&
    isNonNegativeNumber(value.arrivalTimeMinutes) && isNonNegativeInteger(value.transferCount) &&
    Array.isArray(value.legs) && value.legs.length > 0 && value.legs.every((leg) =>
      isRecord(leg) && typeof leg.serviceUid === "string" && typeof leg.trainNumber === "string" &&
      typeof leg.serviceType === "string" && typeof leg.trainName === "string" &&
      typeof leg.originStation === "string" && typeof leg.destinationStation === "string" &&
      isNonNegativeNumber(leg.departureTimeMinutes) && isNonNegativeNumber(leg.arrivalTimeMinutes) &&
      isNonNegativeNumber(leg.scheduledDepartureTimeMinutes) &&
      isNonNegativeNumber(leg.scheduledArrivalTimeMinutes) && isNonNegativeNumber(leg.delayMinutes));
}

function isDailyCongestionPeak(value: unknown): value is DailyCongestionPeak {
  return isRecord(value) && typeof value.collectedAt === "string" &&
    typeof value.sourceUpdatedAt === "string" && isNonNegativeNumber(value.totalCongestion) &&
    isNonNegativeNumber(value.trainCount) && isNonNegativeNumber(value.carCount) &&
    Array.isArray(value.topTrains) && value.topTrains.every((train) =>
      isRecord(train) && typeof train.trainNumber === "string" && isNonNegativeNumber(train.totalCongestion));
}

function isHourlyCongestionAnalysis(value: unknown): value is HourlyCongestionAnalysis {
  return isRecord(value) && isHour(value.hourJst) && isNonNegativeInteger(value.sampleCount) &&
    isNullableNonNegativeNumber(value.averageTotalCongestion) &&
    isNullableNonNegativeNumber(value.peakTotalCongestion) && isNullableString(value.peakCollectedAt) &&
    isNullableNonNegativeNumber(value.averageTrainCount) &&
    (value.topTrain === null || isTrainCongestionStat(value.topTrain));
}

function isTrainCongestionStat(value: unknown): value is TrainCongestionStat {
  return isRecord(value) && typeof value.trainNumber === "string" &&
    isNonNegativeInteger(value.observedSampleCount) && isNonNegativeNumber(value.averageCongestion) &&
    isNonNegativeNumber(value.dailyAverageContribution) && isNonNegativeNumber(value.peakCongestion) &&
    typeof value.peakCollectedAt === "string";
}

function isTrainDelaySnapshotAnalysis(value: unknown): value is TrainDelaySnapshotAnalysis {
  return isRecord(value) && typeof value.collectedAt === "string" &&
    [value.sourceCount, value.failureCount, value.observedTrainCount, value.delayedTrainCount].every(isNonNegativeInteger) &&
    isNonNegativeNumber(value.totalDelayMinutes) && isNonNegativeNumber(value.maximumDelayMinutes) &&
    Array.isArray(value.topTrains) && value.topTrains.every((train) =>
      isRecord(train) && typeof train.trainNumber === "string" && isNonNegativeNumber(train.delayMinutes));
}

function isHourlyTrainDelayAnalysis(value: unknown): value is HourlyTrainDelayAnalysis {
  return isRecord(value) && isHour(value.hourJst) && isNonNegativeInteger(value.sampleCount) &&
    isNullableNonNegativeNumber(value.averageDelayedTrainCount) &&
    isNullableNonNegativeNumber(value.peakDelayedTrainCount) &&
    isNullableNonNegativeNumber(value.peakTotalDelayMinutes) &&
    isNullableNonNegativeNumber(value.maximumDelayMinutes) && isNullableString(value.peakCollectedAt);
}

function isTrainDelayStat(value: unknown): value is TrainDelayStat {
  return isRecord(value) && typeof value.trainNumber === "string" &&
    isNonNegativeInteger(value.delayedSampleCount) && isNonNegativeNumber(value.averageDelayWhenDelayed) &&
    isNonNegativeNumber(value.dailyAverageDelayContribution) && isNonNegativeNumber(value.peakDelayMinutes) &&
    typeof value.peakCollectedAt === "string";
}

function isMessage(value: unknown): value is BedrockAgentMessage {
  return isRecord(value) && (value.role === "assistant" || value.role === "user") &&
    Array.isArray(value.content) && value.content.length > 0 && value.content.every(isContentBlock);
}
function isContentBlock(value: unknown): value is BedrockAgentContentBlock {
  if (!isRecord(value)) return false;
  if (typeof value.text === "string") return true;
  return isRecord(value.toolUse) && typeof value.toolUse.toolUseId === "string" &&
    typeof value.toolUse.name === "string" && isRecord(value.toolUse.input);
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function isNonNegativeNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function isNonNegativeInteger(value: unknown): value is number { return isNonNegativeNumber(value) && Number.isInteger(value); }
function isHour(value: unknown): value is number { return isNonNegativeInteger(value) && value <= 23; }
function isNullableNonNegativeNumber(value: unknown): value is number | null { return value === null || isNonNegativeNumber(value); }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
