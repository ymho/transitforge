import type { Trip } from "@raiquora/trip/trip";
import type { AgentOperation } from "../../ports/agent-operation.js";
import type { ServerAgentToolBinding } from "./server-tools.js";
import { externalTravelEvidence } from "@raiquora/agent/external-travel-evidence";
import { stableContractHash } from "@raiquora/agent/output-contract";
import { placeAtTripItemEdge } from "./trip-gap-search-location.js";
import type { WeatherForecastProvider } from "../../ports/weather-provider.js";
import { nearbyWeatherCandidateIds, tripGapWeather } from "./trip-gap-weather.js";

/** Discovery-only: provider proximity is a ranking hint, so bound results locally when coordinates exist. */
export function tripGapPlaceTool(trip: Trip, searchPlaces: AgentOperation, weather?: WeatherForecastProvider): ServerAgentToolBinding {
  return { descriptor: { name: "search_trip_gap_places",
    description: "Tripの指定予定の後に立ち寄る観光施設等を探す。日付と地域があるときは天気予報も確認し、雨なら距離の短い候補や屋内候補を検討する。屋内性・営業・次の予定への移動可能性は未検証。主目的地や確定済み予定を消さず、Tripに採用しない。",
    effect: "read", prerequisite: ["trusted_trip_scope"], requiredCapabilities: ["trip.read"],
    inputSchema: { type: "object", additionalProperties: false, required: ["anchorItemId", "query"], properties: {
      anchorItemId: { type: "string", minLength: 1, maxLength: 200 }, expectedRevision: { type: "integer", minimum: 0 },
      query: { type: "string", minLength: 1, maxLength: 100 }, radiusMeters: { type: "integer", minimum: 500, maximum: 10_000 },
      limit: { type: "integer", minimum: 1, maximum: 8 },
    } },
  }, operation: async (input, context) => {
    if (input.expectedRevision !== undefined && input.expectedRevision !== trip.revision) return fail(409, "stale_revision", "Tripが更新されました。最新の旅程から検索し直してください");
    const index = trip.items.findIndex(item => item.id === input.anchorItemId);
    if (index < 0) return fail(404, "not_found", "このTripに指定の予定はありません");
    const anchor = trip.items[index]!;
    const center = placeAtTripItemEdge(anchor, "after");
    if (!center?.coordinate && !center?.area) return fail(412, "precondition_missing", "予定の検索起点となる地域または座標がありません");
    const next = trip.items[index + 1], nextPlace = next && placeAtTripItemEdge(next, "before");
    const radiusMeters = typeof input.radiusMeters === "number" ? input.radiusMeters : 5_000;
    const query = String(input.query).trim();
    const providerResult = await searchPlaces({ query: center.coordinate ? query : `${query} ${center.area}`.slice(0, 100),
      ...(center.coordinate ? { latitude: center.coordinate.latitude, longitude: center.coordinate.longitude } : {}),
      limit: input.limit ?? 5 }, context);
    if ((providerResult.statusCode ?? 200) >= 400) return providerResult;
    const result = providerResult.body.result;
    let excludedOutOfRadius = 0, unknownDistance = 0;
    const resultWithBounds = record(result) && record(result.data) && Array.isArray(result.data.places) && center.coordinate
      ? { ...result, data: { ...result.data, places: result.data.places.filter(raw => {
        if (!record(raw) || typeof raw.latitude !== "number" || typeof raw.longitude !== "number" ||
            !Number.isFinite(raw.latitude) || !Number.isFinite(raw.longitude)) { unknownDistance++; return true; }
        if (distanceMeters(center.coordinate!, { latitude: raw.latitude, longitude: raw.longitude }) > radiusMeters) { excludedOutOfRadius++; return false; }
        return true;
      }) } } : result;
    const weatherResult = weather ? await tripGapWeather(trip, anchor, center.area ?? "", weather) : undefined;
    const places = record(resultWithBounds) && record(resultWithBounds.data) && Array.isArray(resultWithBounds.data.places)
      ? resultWithBounds.data.places : [];
    const ranked = weatherResult?.weatherContext.rainRisk === "high" && center.coordinate
      ? nearbyWeatherCandidateIds(places, center.coordinate, "providerPlaceId") : [];
    return { body: { ...providerResult.body, result: resultWithBounds,
      ...(weatherResult ? { ...weatherResult,
        weatherContext: { ...weatherResult.weatherContext,
          ...(ranked.length ? { nearbyCandidateIds: ranked,
            rankingBasis: "straight_line_distance_to_saved_anchor_only; indoor_status_and_travel_time_unverified",
            forecastUsedForRanking: true } : {}) } } : {}),
      searchContext: { tripId: trip.id, sourceRevision: trip.revision, anchorItemId: anchor.id,
        ...(next ? { nextItemId: next.id, nextSchedule: next.schedule } : {}),
        center: { name: center.name, ...(center.area ? { area: center.area } : {}),
          ...(center.coordinate ? { coordinate: center.coordinate } : {}), source: center.sources.length ? "retained-provider-snapshot" : "unverified-manual-snapshot" },
        ...(nextPlace ? { nextPlace: { name: nextPlace.name, ...(nextPlace.area ? { area: nextPlace.area } : {}) } } : {}),
        spatialAssessment: center.coordinate ? "straight-line-radius-from-retained-coordinate" : "area-query-only-unverified",
        ...(center.coordinate ? { radiusMeters, excludedOutOfRadius, unknownDistance } : {}),
        coverage: "limited-provider-results-not-exhaustive", travelTimeVerified: false, openingHoursVerified: false,
        eventScheduleVerified: false, adopted: false } } };
  }, evidence: (output, context) => {
    const provider = [...externalTravelEvidence(record(output) ? { result: output.result } : output, context),
      ...externalTravelEvidence(record(output) ? { forecast: output.forecast } : output, context)];
    if (!record(output) || !record(output.searchContext) || typeof output.searchContext.tripId !== "string" ||
        !Number.isSafeInteger(output.searchContext.sourceRevision) || typeof output.searchContext.anchorItemId !== "string") return provider;
    const scope = output.searchContext, hash = stableContractHash({ anchorItemId: scope.anchorItemId, queryFingerprint: context.queryFingerprint }).slice(0, 16);
    return [...provider, { id: `trip-gap-places:${context.executionId}:${scope.sourceRevision}:${hash}`,
      category: "external", knowledgeKind: "deterministic_fact", subject: `trip:${scope.tripId}`,
      facts: { anchorItemId: scope.anchorItemId as string, travelTimeVerified: false, eventScheduleVerified: false,
        ...(typeof scope.nextItemId === "string" ? { nextItemId: scope.nextItemId } : {}) },
      references: [{ sourceType: "trip-state", sourceRef: `${scope.tripId}@${scope.sourceRevision}`, retrievedAt: context.retrievedAt,
        freshness: "current", summary: "旅程の保存済み地点を検索起点に使用。移動・営業・イベント開催日は未検証" }], coverage: ["trip.itinerary"] }];
  } };
}
function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (value: number) => value * Math.PI / 180, lat = radians(b.latitude - a.latitude), lon = radians(b.longitude - a.longitude);
  const chord = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lon / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(chord));
}
function fail(statusCode: number, code: string, message: string) { return { statusCode, body: { code, message } }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
