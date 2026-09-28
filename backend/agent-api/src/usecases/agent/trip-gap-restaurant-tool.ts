import type { Trip } from "@raiquora/trip/trip";
import type { AgentOperation } from "../../ports/agent-operation.js";
import type { ServerAgentToolBinding } from "./server-tools.js";
import { externalTravelEvidence } from "@raiquora/agent/external-travel-evidence";
import { stableContractHash } from "@raiquora/agent/output-contract";
import type { RestaurantRequirements } from "@raiquora/trip/restaurant-search";
import { placeAtTripItemEdge } from "./trip-gap-search-location.js";
import type { WeatherForecastProvider } from "../../ports/weather-provider.js";
import { nearbyWeatherCandidateIds, tripGapWeather } from "./trip-gap-weather.js";

const requirementKeys = ["lunch", "lateNight", "childFriendly", "nonSmoking", "barrierFree", "parking", "privateRoom", "cardAccepted"] as const;

/** A per-turn, authenticated Trip binding. Neither an arbitrary tripId nor a model-supplied search center is accepted. */
export function tripGapRestaurantTool(trip: Trip, searchRestaurants: AgentOperation, weather?: WeatherForecastProvider): ServerAgentToolBinding {
  return {
    descriptor: { name: "search_trip_gap_restaurants",
      description: "Tripの指定予定の直後に入れる飲食店候補を保存済み地点から探す。日付・地域があれば天気予報を添え、雨なら近い店を検討する。距離・所要時間・営業時間の適合は未検証。検索のみでTripは変更しない。",
      effect: "read", prerequisite: ["trusted_trip_scope"], requiredCapabilities: ["trip.read"],
      inputSchema: { type: "object", additionalProperties: false, required: ["anchorItemId"], properties: {
        anchorItemId: { type: "string", minLength: 1, maxLength: 200 }, expectedRevision: { type: "integer", minimum: 0 },
        keyword: { type: "string", maxLength: 100 }, limit: { type: "integer", minimum: 1, maximum: 10 },
        requirements: { type: "object", additionalProperties: false, properties: Object.fromEntries(requirementKeys.map(key => [key, { type: "boolean" }])) },
      } },
    },
    operation: async (input, context) => {
      if (input.expectedRevision !== undefined && input.expectedRevision !== trip.revision) return failure(409, "stale_revision", "Tripが更新されました。最新の旅程から検索し直してください");
      const anchorItemId = input.anchorItemId;
      const index = typeof anchorItemId === "string" ? trip.items.findIndex(item => item.id === anchorItemId) : -1;
      if (index < 0) return failure(404, "not_found", "このTripに指定の予定はありません");
      const anchor = trip.items[index]!;
      const center = placeAtTripItemEdge(anchor, "after");
      if (!center?.coordinate && !center?.area) return failure(412, "precondition_missing", "予定の検索起点となる地域または座標がありません");
      const next = trip.items[index + 1];
      const nextPlace = next && placeAtTripItemEdge(next, "before");
      const request = { area: center.area ?? center.name, ...(center.coordinate ? { latitude: center.coordinate.latitude, longitude: center.coordinate.longitude, range: 3 } : {}),
        ...(typeof input.keyword === "string" && input.keyword.trim() ? { keyword: input.keyword.trim() } : {}),
        ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        ...(input.requirements && typeof input.requirements === "object" ? { requirements: input.requirements as RestaurantRequirements } : {}) };
      const result = await searchRestaurants(request, context);
      if ((result.statusCode ?? 200) >= 400) return result;
      const resultSet = result.body.restaurants;
      const candidates = record(resultSet) && resultSet.status === "available" && record(resultSet.data) && Array.isArray(resultSet.data.restaurants)
        ? resultSet.data.restaurants : undefined;
      const candidateCount = candidates?.length;
      const weatherResult = weather ? await tripGapWeather(trip, anchor, center.area ?? "", weather) : undefined;
      const ranked = weatherResult?.weatherContext.rainRisk === "high" && center.coordinate && candidates
        ? nearbyWeatherCandidateIds(candidates, center.coordinate, "providerRestaurantId") : [];
      return { body: { ...result.body, ...(weatherResult ? { ...weatherResult,
        weatherContext: { ...weatherResult.weatherContext,
          ...(ranked.length ? { nearbyCandidateIds: ranked,
            rankingBasis: "straight_line_distance_to_saved_anchor_only; indoor_status_and_travel_time_unverified",
            forecastUsedForRanking: true } : {}) } } : {}), searchContext: { tripId: trip.id, sourceRevision: trip.revision, anchorItemId: anchor.id,
        ...(next ? { nextItemId: next.id, nextSchedule: next.schedule } : {}),
        center: { name: center.name, ...(center.area ? { area: center.area } : {}),
          ...(center.coordinate ? { coordinate: center.coordinate } : {}), source: center.sources.length ? "retained-provider-snapshot" : "unverified-manual-snapshot" },
        ...(nextPlace ? { nextPlace: { name: nextPlace.name, ...(nextPlace.area ? { area: nextPlace.area } : {}) } } : {}),
        evaluation: "candidates-near-anchor-only; distance-to-next-and-travel-time-unverified",
        resultCoverage: candidates ? candidateCount ? "candidates_returned" : "no_candidates_in_limited_response" : "unavailable_or_unknown",
        ...(candidateCount === undefined ? {} : { returnedCandidateCount: candidateCount }) } } };
    },
    evidence: (output, context) => {
      const providerEvidence = [...externalTravelEvidence(record(output) ? { restaurants: output.restaurants } : output, context),
        ...externalTravelEvidence(record(output) ? { forecast: output.forecast } : output, context)];
      if (!record(output) || !record(output.searchContext) || typeof output.searchContext.tripId !== "string" ||
          !Number.isSafeInteger(output.searchContext.sourceRevision) || typeof output.searchContext.anchorItemId !== "string") return providerEvidence;
      const scope = output.searchContext, hash = stableContractHash({ anchorItemId: scope.anchorItemId, nextItemId: scope.nextItemId }).slice(0, 16);
      return [...providerEvidence, { id: `trip-gap-restaurants:${context.executionId}:${scope.sourceRevision}:${hash}`, category: "external", knowledgeKind: "deterministic_fact",
        subject: `trip:${scope.tripId}`, facts: { anchorItemId: scope.anchorItemId as string,
          ...(typeof scope.nextItemId === "string" ? { nextItemId: scope.nextItemId } : {}), travelTimeVerified: false, nextProximityVerified: false,
          ...(scope.resultCoverage === "no_candidates_in_limited_response" ? { resultCoverage: "no_candidates_in_limited_response", returnedCandidateCount: 0 } : {}) },
        references: [{ sourceType: "trip-state", sourceRef: `${scope.tripId}@${scope.sourceRevision}`, retrievedAt: context.retrievedAt,
          freshness: "current", summary: "保存済み地点を飲食店検索の起点に使用。次の予定への近さ・移動時間は未検証" }], coverage: ["trip.itinerary"] }];
    },
  };
}

function failure(statusCode: number, code: string, message: string) { return { statusCode, body: { code, message } }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
