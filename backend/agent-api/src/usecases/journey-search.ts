import { searchJourneyIndex, type JourneyOperation, type JourneySearchRequest } from "@raiquora/journey";
import { isValidServiceDate } from "@raiquora/operation";

import { type JsonObject, RequestError } from "../contracts/agent-request.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { JourneyDataRepository } from "../ports/journey-data.js";

const constraintNames = ["excludedServiceTypes", "excludedTrainNames", "excludedTrainNumbers", "excludedServiceUids", "requiredServiceTypes", "requiredTrainNames", "requiredTrainNumbers", "allowedServiceTypes"] as const;
export const journeySearchContractVersion = "journey-search-v1";

export function createJourneySearchOperation(repository: JourneyDataRepository, options: { now?: () => Date; log?: (event: string, fields: Record<string, unknown>) => void } = {}): AgentOperation {
  const now = options.now ?? (() => new Date()); const log = options.log ?? (() => undefined);
  return async (value, context) => {
    const request = validatedJourneyRequest(value);
    const realtime = await currentRealtime(repository, request, now());
    const index = await repository.loadIndex(request.serviceDate, request.maxTransfers! <= 1 ? "direct-service" : "connection");
    let result;
    try { result = searchJourneyIndex(request, { index, operations: realtime.operations, realtimeRouteTime: realtime.routeTime }); }
    catch (error) { throw new RequestError(503, error instanceof Error ? error.message : "経路を検索できません。"); }
    const realtimeMetadata = realtime.metadata;
    result.trace.realtime = realtimeMetadata;
    log("journey_search_completed", { requestId: context.requestId, serviceDate: request.serviceDate, journeyCount: result.journeys.length, strategy: result.trace.strategy, realtimeApplied: realtimeMetadata.applied });
    const body: JsonObject = { contractVersion: journeySearchContractVersion, ...result, realtime: realtimeMetadata };
    if (!value.includeTrace) delete body.trace;
    return { body };
  };
}

export function validatedJourneyRequest(value: JsonObject): JourneySearchRequest {
  if (value.contractVersion !== journeySearchContractVersion) throw new RequestError(400, "journey_searchの契約versionが不正です。");
  const originStation = requiredText(value.originStation, "originStationが必要です。");
  const destinationStation = requiredText(value.destinationStation, "destinationStationが必要です。");
  if (typeof value.serviceDate !== "string") throw new RequestError(400, "serviceDateが必要です。");
  if (!isValidServiceDate(value.serviceDate)) throw new RequestError(400, "serviceDateが実在する日付ではありません。");
  if (typeof value.departureTimeMinutes !== "number" || !Number.isFinite(value.departureTimeMinutes) || value.departureTimeMinutes < 0 || value.departureTimeMinutes > 2_880) throw new RequestError(400, "departureTimeMinutesが不正です。");
  const limit = value.limit ?? 3; if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 5) throw new RequestError(400, "limitは1から5にしてください。");
  const maxTransfers = value.maxTransfers ?? 3; if (!Number.isInteger(maxTransfers) || (maxTransfers as number) < 0 || (maxTransfers as number) > 3) throw new RequestError(400, "maxTransfersは0から3にしてください。");
  const transferPace = value.transferPace ?? "standard"; if (transferPace !== "hurried" && transferPace !== "standard" && transferPace !== "relaxed") throw new RequestError(400, "transferPaceが不正です。");
  const rankingPreference = value.rankingPreference ?? "balanced"; if (rankingPreference !== "balanced" && rankingPreference !== "earliest-arrival" && rankingPreference !== "latest-departure" && rankingPreference !== "fewest-transfers") throw new RequestError(400, "rankingPreferenceが不正です。");
  const constraints = Object.fromEntries(constraintNames.map((name) => [name, constraintList(value[name])]));
  if (["requiredServiceTypes", "requiredTrainNames", "requiredTrainNumbers"].reduce((sum, name) => sum + (constraints[name] as string[]).length, 0) > 4) throw new RequestError(400, "利用したい列車条件が多すぎます。");
  if (value.includeTrace !== undefined && typeof value.includeTrace !== "boolean") throw new RequestError(400, "includeTraceが不正です。");
  return { serviceDate: value.serviceDate, originStation, destinationStation, departureTimeMinutes: value.departureTimeMinutes, limit: limit as number, maxTransfers: maxTransfers as 0 | 1 | 2 | 3, transferPace, rankingPreference, ...constraints };
}

async function currentRealtime(repository: JourneyDataRepository, request: JourneySearchRequest, now: Date): Promise<{ operations?: Record<string, JourneyOperation>; routeTime?: number; metadata: JsonObject }> {
  const currentServiceDate = serviceDateAt(now); const base: JsonObject = { applied: false, reason: "future-or-past-service-date", currentServiceDate };
  if (request.serviceDate !== currentServiceDate) return { metadata: base };
  const snapshot = await repository.loadRealtimeSnapshot(); if (!snapshot) return { metadata: { ...base, reason: "snapshot-unavailable" } };
  if (!Array.isArray(snapshot.failedSources) || snapshot.failedSources.length > 0 || typeof snapshot.collectedAt !== "string" || !isRecord(snapshot.trains)) return { metadata: { ...base, reason: "snapshot-incomplete" } };
  const collected = new Date(snapshot.collectedAt); if (Number.isNaN(collected.getTime()) || Math.abs(now.getTime() - collected.getTime()) > 5 * 60_000) return { metadata: { ...base, reason: "snapshot-stale" } };
  const requestedAt = Date.parse(`${request.serviceDate}T00:00:00+09:00`) + request.departureTimeMinutes * 60_000;
  if (Math.abs(requestedAt - collected.getTime()) > 5 * 60_000) return { metadata: { ...base, reason: "search-time-not-current" } };
  const operations = Object.fromEntries(Object.entries(snapshot.trains).flatMap(([number, operation]) => validOperation(operation) ? [[number, operation]] : [])) as Record<string, JourneyOperation>;
  const routeTime = (collected.getTime() - Date.parse(`${request.serviceDate}T00:00:00+09:00`)) / 60_000;
  return { operations, routeTime, metadata: { ...base, applied: true, reason: "current-complete-snapshot", snapshotCollectedAt: snapshot.collectedAt, snapshotRouteTimeMinutes: routeTime, operationCount: Object.keys(operations).length } };
}

function serviceDateAt(now: Date): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() - 4 * 60 * 60_000)); }
function validOperation(value: unknown): value is JourneyOperation { return isRecord(value) && typeof value.delayMinutes === "number" && value.delayMinutes >= 0 && typeof value.destination === "string" && Array.isArray(value.sources) && value.sources.every((source) => typeof source === "string"); }
function requiredText(value: unknown, message: string): string { if (typeof value !== "string" || !value.trim()) throw new RequestError(400, message); return value.trim(); }
function constraintList(value: unknown): string[] { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 8 || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 160)) throw new RequestError(400, "列車の検索条件が不正です。"); return [...new Set(value.map((item) => (item as string).trim()))]; }
function isRecord(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
