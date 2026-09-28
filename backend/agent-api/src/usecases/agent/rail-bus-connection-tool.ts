import type { ServerAgentToolBinding } from "./server-tools.js";
import type { AgentOperation } from "../../ports/agent-operation.js";
import type { GroundRouteProvider } from "../../ports/ground-route-provider.js";
import type { StationCatalogRepository } from "../../ports/station-catalog-repository.js";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import { searchRailBusConnections } from "../rail-bus-connections.js";
import { journeySearchContractVersion } from "../journey-search.js";
import { stableContractHash } from "@raiquora/agent/output-contract";

/** Composite read-only Tool: model supplies a desired place; catalog, rail times and OTP prove possible connections. */
export function railBusConnectionTool(stations: StationCatalogRepository, rail: AgentOperation,
  ground: GroundRouteProvider): ServerAgentToolBinding {
  return { descriptor: { name: "search_rail_bus_connections", effect: "read",
    description: "指定日の出発駅から目的地まで、最大3駅の鉄道→バス・徒歩接続候補を照合する。公式アクセス案内の駅名は探索ヒントのみ。予定時刻でありTripは変更しない。",
    inputSchema: { type: "object", additionalProperties: false, required: ["originStation", "destination", "departureAt"], properties: {
      originStation: { type: "string", minLength: 1, maxLength: 120 }, departureAt: { type: "string", minLength: 25, maxLength: 25 },
      destination: { type: "object", additionalProperties: false, required: ["name", "latitude", "longitude"], properties: {
        name: { type: "string", minLength: 1, maxLength: 120 }, latitude: { type: "number", minimum: -90, maximum: 90 },
        longitude: { type: "number", minimum: -180, maximum: 180 },
      } }, preferredStations: { type: "array", maxItems: 3, items: { type: "string", minLength: 1, maxLength: 120 } },
    } },
  }, operation: async (input, context) => {
    if (typeof input.departureAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/u.test(input.departureAt) || !Number.isFinite(Date.parse(input.departureAt)))
      return { statusCode: 400, body: { code: "invalid_input", message: "日本時間の出発日時を指定してください" } };
    try {
      const catalog = await stations.load();
      const response = await searchRailBusConnections({ originStation: String(input.originStation),
        destination: input.destination as { name: string; latitude: number; longitude: number }, departureAt: String(input.departureAt),
        ...(Array.isArray(input.preferredStations) ? { preferredStations: input.preferredStations as string[] } : {}),
        stationCatalog: catalog, ground, railSearch: async request => {
          const result = await rail({ contractVersion: journeySearchContractVersion, ...request }, context);
          if ((result.statusCode ?? 200) >= 400 || !Array.isArray(result.body.journeys) || typeof result.body.serviceDate !== "string") throw new Error("Rail search unavailable");
          return result.body as unknown as JourneySearchResponse;
        } });
      // Route shape belongs in a separately validated map presentation, not the model's tool context.
      const compact = { ...response, candidates: response.candidates.map(candidate => ({ ...candidate,
        bus: { ...candidate.bus, legs: candidate.bus.legs.map(({ geometry: _geometry, ...leg }) => leg) } })) };
      return { body: { railBusConnections: compact, stationCatalogSource: catalog.source,
        destinationBasis: "unverified-candidate-coordinate", adopted: false, operatingNowVerified: false } };
    } catch { return { statusCode: 503, body: { code: "unavailable", message: "鉄道・バスの乗継を検証できません" } }; }
  }, evidence: (output, context) => {
    if (!record(output) || !record(output.railBusConnections) || typeof output.stationCatalogSource !== "string") return [];
    const value = output.railBusConnections;
    const candidates = Array.isArray(value.candidates) ? value.candidates.filter(record).slice(0, 5) : [];
    const firstCoverage = candidates.length && record(candidates[0]!.busCoverage) ? candidates[0]!.busCoverage : undefined;
    const id = `rail-bus:${context.executionId}:${stableContractHash(context.queryFingerprint).slice(0, 16)}`;
    return [{ id, category: "external", knowledgeKind: "deterministic_fact", subject: "rail-bus-connection",
      facts: { status: String(value.status), stationsConsidered: Array.isArray(value.stationsConsidered) ? value.stationsConsidered.filter((item): item is string => typeof item === "string") : [],
        dataFailures: typeof value.dataFailures === "number" ? value.dataFailures : 0,
        connectionSummaries: candidates.map(candidate => {
          const station = record(candidate.station) ? candidate.station : {}, railJourney = record(candidate.rail) ? candidate.rail : {}, bus = record(candidate.bus) ? candidate.bus : {};
          return `${String(station.name)}（鉄道到着 ${String(candidate.railArrivalAt)}、乗継余裕${String(candidate.transferMinutes)}分、バス出発 ${String(bus.departureAt)}、目的地到着 ${String(bus.arrivalAt)}、列車${Array.isArray(railJourney.legs) ? railJourney.legs.length : "?"}区間）`.slice(0, 400);
        }), operatingNowVerified: false, adopted: false },
      references: [{ sourceType: "station-line-catalog", sourceRef: output.stationCatalogSource,
        retrievedAt: context.retrievedAt, freshness: "unknown", summary: "駅座標は生成済み駅カタログ。鉄道は指定日の自前ダイヤ。候補地点は未採用、運行状況は未確認" },
      ...(firstCoverage && typeof firstCoverage.feedUrl === "string" ? [{ sourceType: "external-source" as const, sourceRef: firstCoverage.feedUrl,
        retrievedAt: typeof candidates[0]!.busCheckedAt === "string" ? candidates[0]!.busCheckedAt : context.retrievedAt, freshness: "unknown" as const,
        summary: `GTFS取得: ${String(firstCoverage.feedRetrievedAt)}、グラフ作成: ${String(firstCoverage.graphBuiltAt)}。バス・徒歩はOTPの予定経路` }] : [])], coverage: ["rail.connection"] }];
  } };
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
