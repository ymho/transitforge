import { type JsonObject, RequestError } from "../contracts/agent-request.js";
import type { AgentOperation } from "../ports/agent-operation.js";
import type { RepresentativeTimetableKind, RepresentativeTimetableRepository } from "../ports/operation-data.js";

type SearchMode = "active" | "arrivals" | "departures";

export function createRepresentativeTimetableOperation(repository: RepresentativeTimetableRepository): AgentOperation {
  return async (request) => ({ body: await searchRepresentativeTimetable(repository, request) });
}

export async function searchRepresentativeTimetable(
  repository: RepresentativeTimetableRepository,
  request: JsonObject,
): Promise<JsonObject> {
  const kind = request.timetableKind;
  const query = request.query;
  const mode = request.mode;
  const targetTime = request.targetTimeMinutes;
  const rawLimit = request.limit ?? 5;
  if (kind !== "weekday" && kind !== "weekend_holiday") throw new RequestError(400, "timetableKindが不正です。");
  if (typeof query !== "string" || !query.trim() || query.length > 200) throw new RequestError(400, "queryが不正です。");
  if (mode !== "active" && mode !== "arrivals" && mode !== "departures") throw new RequestError(400, "modeが不正です。");
  if (targetTime !== undefined && targetTime !== null && (typeof targetTime !== "number" || !Number.isFinite(targetTime) || targetTime < 0 || targetTime > 2_160)) throw new RequestError(400, "targetTimeMinutesが不正です。");
  if (!Number.isInteger(rawLimit)) throw new RequestError(400, "limitが不正です。");
  const limit = Math.max(1, Math.min(5, rawLimit as number));
  const timetable = await repository.load(kind);
  if (!Array.isArray(timetable.trains)) throw new Error("Representative timetable has no trains array");
  const trains = timetable.trains.filter(isRecord);
  const normalizedQuery = normalize(query);
  const stations = matchingValues(trains.flatMap((train) => Array.isArray(train.stops) ? train.stops.filter(isRecord).map((stop) => stop.station_name) : []), normalizedQuery);
  const serviceTypes = matchingValues(trains.map((train) => train.service_type), normalizedQuery);
  const trainNames = matchingValues(trains.map((train) => train.train_name).filter((value) => normalize(value) !== ""), normalizedQuery);
  const trainNumbers = matchingValues(trains.map((train) => train.train_no).filter((value) => normalize(value).length >= 2), normalizedQuery);
  if (stations.size + serviceTypes.size + trainNames.size + trainNumbers.size === 0) return response(timetable, kind, mode, targetTime, [], 0);
  const ranked = trains.flatMap((train) => {
    if (!trainMatches(train, stations, serviceTypes, trainNames, trainNumbers)) return [];
    const stops = matchingStops(train, stations, mode, typeof targetTime === "number" ? targetTime : null);
    if (mode === "active" && typeof targetTime === "number") {
      const times = (Array.isArray(train.stops) ? train.stops : []).filter(isRecord).map((stop) => stop.route_time_minutes).filter((value): value is number => typeof value === "number");
      if (times.length === 0 || targetTime < Math.min(...times) || targetTime > Math.max(...times)) return [];
    } else if (mode !== "active" && stops.length === 0) return [];
    const nearest = typeof targetTime === "number" && stops.length > 0
      ? Math.min(...stops.map((stop) => Math.abs((stop.routeTimeMinutes as number) - targetTime)))
      : 0;
    return [{ nearest, value: { trainNumber: stringValue(train.train_no), serviceType: stringValue(train.service_type), trainName: stringValue(train.train_name), origin: stringValue(train.origin_station), destination: stringValue(train.destination_station), matchingStops: stops.slice(0, 4) } }];
  }).sort((a, b) => a.nearest - b.nearest || String(a.value.trainNumber).localeCompare(String(b.value.trainNumber)));
  return response(timetable, kind, mode, targetTime, ranked.slice(0, limit).map(({ value }) => value), ranked.length);
}

function matchingValues(values: unknown[], query: string): Set<string> {
  return new Set(values.filter((value): value is string =>
    typeof value === "string" && normalize(value).length > 0 && query.includes(normalize(value))
  ).map(normalize));
}

function trainMatches(train: JsonObject, stations: Set<string>, serviceTypes: Set<string>, trainNames: Set<string>, trainNumbers: Set<string>): boolean {
  const trainStations = new Set((Array.isArray(train.stops) ? train.stops : []).filter(isRecord).map((stop) => normalize(stop.station_name)));
  return (stations.size === 0 || [...stations].some((station) => trainStations.has(station))) &&
    (serviceTypes.size === 0 || serviceTypes.has(normalize(train.service_type))) &&
    (trainNames.size === 0 || trainNames.has(normalize(train.train_name))) &&
    (trainNumbers.size === 0 || trainNumbers.has(normalize(train.train_no)));
}

function matchingStops(train: JsonObject, stations: Set<string>, mode: SearchMode, targetTime: number | null): JsonObject[] {
  const eventText = mode === "arrivals" ? "着" : mode === "departures" ? "発" : undefined;
  return (Array.isArray(train.stops) ? train.stops : []).filter(isRecord).flatMap((stop) => {
    if (typeof stop.station_name !== "string" || typeof stop.route_time_minutes !== "number") return [];
    if (stations.size > 0 && !stations.has(normalize(stop.station_name))) return [];
    if (eventText && !String(stop.event ?? "").includes(eventText)) return [];
    if (targetTime !== null && Math.abs(stop.route_time_minutes - targetTime) > 30) return [];
    return [{ stationName: stop.station_name, event: stringValue(stop.event), routeTimeMinutes: stop.route_time_minutes }];
  });
}

function response(timetable: JsonObject, kind: RepresentativeTimetableKind, mode: SearchMode, targetTime: unknown, matches: JsonObject[], total: number): JsonObject {
  return { timetableKind: kind, serviceDate: timetable.service_date, mode, targetTimeMinutes: targetTime ?? null, totalMatchCount: total, matches };
}

function normalize(value: unknown): string { return typeof value === "string" ? value.normalize("NFKC").trim().replaceAll("ヶ", "ケ") : ""; }
function stringValue(value: unknown): string { return typeof value === "string" ? value : ""; }
function isRecord(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
