import type {
  BedrockAgentContentBlock,
  BedrockAgentMessage,
  BedrockAgentResponse,
  AccommodationSearchResponse,
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
  WeatherForecastSearchResponse,
  WeatherGridSearchResponse,
  PlaceMediaSearchResponse,
  TravelAlertSearchResponse,
  GroundAccessSearchResponse,
  RestaurantSearchResponse,
} from "./bedrock-agent-contract";
import {
  journeySearchContractVersion,
  type JourneySearchWireResponse,
} from "./journey-search-contract";

export function isBedrockAgentResponse(value: unknown): value is BedrockAgentResponse {
  return isRecord(value) && ["end_turn", "tool_use", "max_tokens"].includes(String(value.stopReason)) &&
    isMessage(value.message) && value.message.role === "assistant" &&
    (value.metadata === undefined || isBedrockResponseMetadata(value.metadata));
}

function isBedrockResponseMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.modelId === undefined || typeof value.modelId === "string") &&
    (value.latencyMs === undefined || isNonNegativeNumber(value.latencyMs)) &&
    (value.usage === undefined || (
      isRecord(value.usage) &&
      [value.usage.inputTokens, value.usage.outputTokens, value.usage.totalTokens]
        .every((item) => item === undefined || isNonNegativeInteger(item))
    ));
}

export function isAccommodationSearchResponse(value: unknown): value is AccommodationSearchResponse {
  return isRecord(value) && Array.isArray(value.accommodations) && value.accommodations.length <= 5 &&
    value.accommodations.every((item) => isRecord(item) && item.kind === "accommodation" &&
      typeof item.provider === "string" && typeof item.providerItemId === "string" &&
      typeof item.name === "string" && typeof item.checkInDate === "string" &&
      typeof item.checkOutDate === "string" &&
      (item.bookingUrl === undefined || typeof item.bookingUrl === "string") &&
      (item.areaName === undefined || typeof item.areaName === "string") &&
      (item.imageUrl === undefined || typeof item.imageUrl === "string") &&
      (item.address === undefined || typeof item.address === "string") &&
      (item.latitude === undefined || isCoordinate(item.latitude, -90, 90)) &&
      (item.longitude === undefined || isCoordinate(item.longitude, -180, 180)) &&
      (item.reviewAverage === undefined || isCoordinate(item.reviewAverage, 0, 5)) &&
      (item.reviewCount === undefined || isNonNegativeInteger(item.reviewCount)) &&
      (item.price === undefined || isRecord(item.price) && isNonNegativeInteger(item.price.amount) && item.price.currency === "JPY") &&
      (item.priceBasis === undefined || item.priceBasis === "reference-minimum" || item.priceBasis === "selected-dates") &&
      (item.availability === undefined || item.availability === "available" || item.availability === "unknown"));
}

export function isWeatherForecastSearchResponse(value: unknown): value is WeatherForecastSearchResponse {
  if (!isRecord(value) || !isRecord(value.forecast)) return false;
  const forecast = value.forecast;
  if (!["available", "unavailable", "unknown"].includes(String(forecast.status)) ||
    !["fresh", "stale", "unknown"].includes(String(forecast.freshness)) ||
    !Array.isArray(forecast.evidence) || forecast.evidence.length > 24) return false;
  if (forecast.status !== "available") return forecast.data === undefined;
  const data = forecast.data;
  return isRecord(data) && typeof data.locationName === "string" &&
    typeof data.latitude === "number" && typeof data.longitude === "number" &&
    typeof data.timezone === "string" && typeof data.alertsAvailable === "boolean" && Array.isArray(data.hourly) && data.hourly.length <= 168 &&
    Array.isArray(data.daily) && data.daily.length <= 16;
}

export function isWeatherGridSearchResponse(value: unknown): value is WeatherGridSearchResponse {
  if (!isRecord(value) || !isRecord(value.weatherGrid)) return false;
  const grid = value.weatherGrid;
  if (!weatherInformationEnvelope(grid)) return false;
  if (grid.status !== "available") return grid.data === undefined;
  return isRecord(grid.data) && Array.isArray(grid.data.cells) &&
    grid.data.cells.length <= 9 && grid.data.cells.every((cell) =>
      isRecord(cell) && typeof cell.id === "string" &&
      isCoordinate(cell.latitude, -90, 90) &&
      isCoordinate(cell.longitude, -180, 180) &&
      typeof cell.observedAt === "string" &&
      ["clear", "cloudy", "rain", "snow"].includes(String(cell.mode)) &&
      isNonNegativeNumber(cell.precipitationMillimeters) &&
      isCoordinate(cell.cloudCoverPercent, 0, 100) &&
      isNonNegativeNumber(cell.weatherCode));
}

function weatherInformationEnvelope(value: Record<string, unknown>): boolean {
  return ["available", "unavailable", "unknown"].includes(String(value.status)) &&
    ["fresh", "stale", "unknown"].includes(String(value.freshness)) &&
    Array.isArray(value.evidence) && value.evidence.length <= 24;
}

export function isPlaceMediaSearchResponse(value: unknown): value is PlaceMediaSearchResponse {
  if (!isRecord(value) || !isRecord(value.result)) return false;
  const result = value.result;
  if (!["available", "unavailable", "unknown"].includes(String(result.status)) ||
    !["fresh", "stale", "unknown"].includes(String(result.freshness)) ||
    !Array.isArray(result.evidence) || result.evidence.length > 24) return false;
  if (result.status !== "available") return result.data === undefined;
  return isRecord(result.data) && Array.isArray(result.data.places) && result.data.places.length <= 8 &&
    result.data.places.every((place) => isRecord(place) && typeof place.providerPlaceId === "string" &&
      typeof place.name === "string" && typeof place.sourceUrl === "string" &&
      (place.address === undefined || typeof place.address === "string") &&
      (place.sources === undefined || Array.isArray(place.sources) && place.sources.length <= 12 &&
        place.sources.every((source) => isRecord(source) && typeof source.provider === "string" &&
          typeof source.label === "string" && typeof source.url === "string")) &&
      (place.latitude === undefined || typeof place.latitude === "number") &&
      (place.longitude === undefined || typeof place.longitude === "number") &&
      (place.image === undefined || isRecord(place.image) && typeof place.image.url === "string" &&
        typeof place.image.attribution === "string"));
}

export function isTravelAlertSearchResponse(value: unknown): value is TravelAlertSearchResponse {
  if (!isRecord(value) || !isRecord(value.alerts)) return false;
  const information = value.alerts;
  if (!externalInformationEnvelope(information)) return false;
  if (information.status !== "available") return information.data === undefined;
  return isRecord(information.data) && typeof information.data.area === "string" &&
    Array.isArray(information.data.alerts) && information.data.alerts.length <= 12 &&
    information.data.alerts.every((alert) => isRecord(alert) &&
      typeof alert.providerAlertId === "string" && typeof alert.title === "string" &&
      typeof alert.summary === "string" && typeof alert.issuedAt === "string" &&
      typeof alert.sourceUrl === "string" &&
      ["warning", "weather-information", "typhoon", "earthquake", "tsunami", "volcano", "other"].includes(String(alert.category)) &&
      ["information", "advisory", "warning", "emergency", "unknown"].includes(String(alert.severity)));
}

export function isGroundAccessSearchResponse(value: unknown): value is GroundAccessSearchResponse {
  if (!isRecord(value) || !isRecord(value.groundAccess) || !externalInformationEnvelope(value.groundAccess)) return false;
  const information = value.groundAccess;
  if (information.status !== "available") return information.data === undefined;
  if (!isRecord(information.data) || !isRecord(information.data.origin) || !["walking", "driving", "cycling"].includes(String(information.data.mode))) return false;
  if (isRecord(information.data.destination)) return isNonNegativeNumber(information.data.durationMinutes) && isNonNegativeNumber(information.data.distanceMeters) && Array.isArray(information.data.geometry) && information.data.geometry.length <= 2_000;
  if (Array.isArray(information.data.entries)) return information.data.entries.length <= 9;
  return isNonNegativeNumber(information.data.minutes) && Array.isArray(information.data.polygons) && information.data.polygons.length <= 8;
}

export function isRestaurantSearchResponse(value: unknown): value is RestaurantSearchResponse {
  if (!isRecord(value) || !isRecord(value.restaurants) || !externalInformationEnvelope(value.restaurants)) return false;
  const information = value.restaurants;
  if (information.status !== "available") return information.data === undefined;
  return isRecord(information.data) && isBoundedString(information.data.area, 100) && Array.isArray(information.data.restaurants) && information.data.restaurants.length <= 10 && information.data.restaurants.every((restaurant) => isRecord(restaurant) && isBoundedString(restaurant.providerRestaurantId, 160) && isBoundedString(restaurant.name, 120) && isBoundedString(restaurant.detailUrl, 2_000) && isOptionalBoundedString(restaurant.address, 240) && isOptionalBoundedString(restaurant.genre, 80) && isOptionalBoundedString(restaurant.budget, 100) && isOptionalBoundedString(restaurant.averageBudget, 120) && isOptionalBoundedString(restaurant.openingHours, 240) && isOptionalBoundedString(restaurant.regularHoliday, 160) && isOptionalBoundedString(restaurant.stationName, 100) && isOptionalBoundedString(restaurant.access, 240) && isOptionalBoundedString(restaurant.imageUrl, 2_000) && (restaurant.latitude === undefined || isCoordinate(restaurant.latitude, -90, 90)) && (restaurant.longitude === undefined || isCoordinate(restaurant.longitude, -180, 180)) && (restaurant.features === undefined || Array.isArray(restaurant.features) && restaurant.features.length <= 8 && restaurant.features.every((feature) => isBoundedString(feature, 40))));
}

export function isWebSearchResponse(value: unknown): value is import("./bedrock-agent-contract").WebSearchResponse {
  if (!isRecord(value) || !isRecord(value.webSearch)) return false;
  const information = value.webSearch;
  if (!externalInformationEnvelope(information)) return false;
  if (information.status !== "available") return information.data === undefined;
  return isRecord(information.data) && typeof information.data.query === "string" &&
    Array.isArray(information.data.results) && information.data.results.length <= 8 &&
    information.data.results.every((result) => isRecord(result) && typeof result.id === "string" &&
      typeof result.title === "string" && typeof result.url === "string");
}

export function isWebPageReadResponse(value: unknown): value is import("./bedrock-agent-contract").WebPageReadResponse {
  if (!isRecord(value) || !isRecord(value.webPages)) return false;
  const information = value.webPages;
  if (!externalInformationEnvelope(information)) return false;
  if (information.status !== "available") return information.data === undefined;
  return isRecord(information.data) && Array.isArray(information.data.pages) && information.data.pages.length <= 4 &&
    information.data.pages.every((page) => isRecord(page) && typeof page.url === "string" &&
      typeof page.text === "string" && page.text.length <= 6_000 && page.untrustedExternalContent === true);
}

function externalInformationEnvelope(value: Record<string, unknown>): boolean {
  return ["available", "unavailable", "unknown"].includes(String(value.status)) &&
    ["fresh", "stale", "unknown"].includes(String(value.freshness)) &&
    Array.isArray(value.evidence) && value.evidence.length <= 24;
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

export function isTravelCandidateSearchResponse(value: unknown): value is JourneySearchWireResponse {
  return isRecord(value) && value.contractVersion === journeySearchContractVersion &&
    typeof value.serviceDate === "string" &&
    typeof value.originStation === "string" && typeof value.destinationStation === "string" &&
    isNonNegativeNumber(value.searchTimeMinutes) && isNonNegativeInteger(value.totalMatchCount) &&
    (value.transferPace === undefined || ["hurried", "standard", "relaxed"].includes(String(value.transferPace))) &&
    (value.rankingPreference === undefined || ["balanced", "earliest-arrival", "latest-departure", "fewest-transfers"].includes(String(value.rankingPreference))) &&
    (value.maxTransfers === undefined || (isNonNegativeInteger(value.maxTransfers) && value.maxTransfers <= 3)) &&
    isOptionalConstraintList(value.excludedServiceTypes) &&
    isOptionalConstraintList(value.excludedTrainNames) &&
    isOptionalConstraintList(value.excludedTrainNumbers) &&
    isOptionalConstraintList(value.excludedServiceUids) &&
    isOptionalConstraintList(value.requiredServiceTypes) &&
    isOptionalConstraintList(value.requiredTrainNames) &&
    isOptionalConstraintList(value.requiredTrainNumbers) &&
    isOptionalConstraintList(value.allowedServiceTypes) &&
    Array.isArray(value.matches) && value.matches.length <= 5 && value.matches.every((match) =>
      isRecord(match) && typeof match.serviceUid === "string" &&
      typeof match.trainNumber === "string" && typeof match.serviceType === "string" &&
      typeof match.trainName === "string" && typeof match.originStation === "string" &&
      typeof match.destinationStation === "string" &&
      isNonNegativeNumber(match.departureTimeMinutes) &&
      isNonNegativeNumber(match.arrivalTimeMinutes) &&
      isNonNegativeNumber(match.scheduledDepartureTimeMinutes) &&
      isNonNegativeNumber(match.scheduledArrivalTimeMinutes) &&
      isNonNegativeNumber(match.delayMinutes) && isDelayMetadata(match) &&
      match.source === "transitforge" &&
      ["timetable-graph", "direct-service-index"].includes(String(match.discoverySource)) &&
      typeof match.sourceReference === "string") &&
    Array.isArray(value.journeys) && value.journeys.length <= 5 &&
    value.journeys.every(isJourney);
}

function isJourney(value: unknown): boolean {
  return isRecord(value) && isNonNegativeNumber(value.departureTimeMinutes) &&
    isNonNegativeNumber(value.arrivalTimeMinutes) && isNonNegativeInteger(value.transferCount) &&
    Array.isArray(value.legs) && value.legs.length > 0 && value.legs.every((leg) =>
      isRecord(leg) && typeof leg.serviceUid === "string" && typeof leg.trainNumber === "string" &&
      typeof leg.serviceType === "string" && typeof leg.trainName === "string" &&
      (leg.serviceDestination === undefined || typeof leg.serviceDestination === "string") &&
      typeof leg.originStation === "string" && typeof leg.destinationStation === "string" &&
      isNonNegativeNumber(leg.departureTimeMinutes) && isNonNegativeNumber(leg.arrivalTimeMinutes) &&
      isNonNegativeNumber(leg.scheduledDepartureTimeMinutes) &&
      isNonNegativeNumber(leg.scheduledArrivalTimeMinutes) && isNonNegativeNumber(leg.delayMinutes) &&
      isDelayMetadata(leg) &&
      (leg.stops === undefined || (Array.isArray(leg.stops) && leg.stops.every((stop) =>
        isRecord(stop) && typeof stop.stationName === "string" &&
        (stop.arrivalTimeMinutes === undefined || isNonNegativeNumber(stop.arrivalTimeMinutes)) &&
        (stop.departureTimeMinutes === undefined || isNonNegativeNumber(stop.departureTimeMinutes))))));
}

function isDelayMetadata(value: Record<string, unknown>): boolean {
  return (value.delayStatus === undefined || ["observed", "estimated"].includes(String(value.delayStatus))) &&
    (value.delaySampleCount === undefined || isNonNegativeInteger(value.delaySampleCount)) &&
    (value.delayBasis === undefined || typeof value.delayBasis === "string");
}

function isOptionalConstraintList(value: unknown): boolean {
  return value === undefined ||
    (Array.isArray(value) && value.length <= 8 && value.every((item) =>
      typeof item === "string" && item.length > 0 && item.length <= 160
    ));
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
function isCoordinate(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum; }
function isBoundedString(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length <= maximum; }
function isOptionalBoundedString(value: unknown, maximum: number): boolean { return value === undefined || isBoundedString(value, maximum); }
function isNonNegativeInteger(value: unknown): value is number { return isNonNegativeNumber(value) && Number.isInteger(value); }
function isHour(value: unknown): value is number { return isNonNegativeInteger(value) && value <= 23; }
function isNullableNonNegativeNumber(value: unknown): value is number | null { return value === null || isNonNegativeNumber(value); }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
