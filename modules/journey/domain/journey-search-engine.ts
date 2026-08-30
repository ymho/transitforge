import type { JourneySearchLeg, JourneySearchRequest, JourneySearchResponse } from "./journey-search-service";

export interface JourneyOperation { delayMinutes: number; destination: string; sources: string[]; }
export interface JourneySearchRuntimeInput { index: Record<string, unknown>; delays?: Record<string, number>; operations?: Record<string, JourneyOperation>; realtimeRouteTime?: number; }
export interface JourneySearchTrace {
  schemaVersion: "journey-search-trace-v1";
  strategy: "direct-service-index" | "multi-criteria-connection-scan";
  labelsRejectedByTransferTime: number; labelsRejectedByNonUniqueStation: number;
  realtimeActiveServicesRejected: number; excludedTrips: number; excludedServices: number;
  excludedServiceConnectionsRejected: number; connectionsScanned: number;
  estimatedDelayTrips: number; observedDelayTrips: number;
  stationTransferRulesUsed: Record<string, number>;
  selectedJourneys: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface ServiceCall { stationName: string; arrivalTimeMinutes?: number; departureTimeMinutes?: number; }
interface SearchService { serviceUid: string; trainNumber: string; serviceType: string; trainName: string; originStation: string; destinationStation: string; calls: ServiceCall[]; }
interface DelayInfo { delayMinutes: number; delayStatus?: "observed" | "estimated"; delaySampleCount?: number; delayBasis?: string; }
type NormalizedRequest = Required<Pick<JourneySearchRequest, "limit" | "maxTransfers" | "transferPace" | "rankingPreference">> & JourneySearchRequest;
interface SearchContext { request: NormalizedRequest; servicesByStation: Map<string, SearchService[]>; stationTransferMinutes: Record<string, number>; defaultTransferMinutes: number; delays: Map<string, DelayInfo>; labels: Map<string, Array<{ arrival: number; departure: number }>>; reachableStationsByLeg: Array<Set<string>>; trace: JourneySearchTrace; }

export function searchJourneyIndex(request: JourneySearchRequest, input: JourneySearchRuntimeInput): JourneySearchResponse & { trace: JourneySearchTrace } {
  const strategy = input.index.schema_version === "direct-service-index-v1" ? "direct-service-index" : "multi-criteria-connection-scan";
  const { services, defaultTransferMinutes, stationTransferMinutes, connectionCount } = servicesFromIndex(input.index);
  const normalizedRequest: NormalizedRequest = { ...request, limit: request.limit ?? 3, maxTransfers: request.maxTransfers ?? 3, transferPace: request.transferPace ?? "standard", rankingPreference: request.rankingPreference ?? "balanced" };
  const eligible = services.filter((service) => !excluded(service, normalizedRequest) && allowed(service, normalizedRequest));
  const trace: JourneySearchTrace = {
    schemaVersion: "journey-search-trace-v1", strategy,
    labelsRejectedByTransferTime: 0, labelsRejectedByNonUniqueStation: 0,
    realtimeActiveServicesRejected: 0, excludedTrips: services.length - eligible.length,
    excludedServices: services.length - eligible.length, excludedServiceConnectionsRejected: 0,
    connectionsScanned: connectionCount, estimatedDelayTrips: 0, observedDelayTrips: 0,
    stationTransferRulesUsed: {}, selectedJourneys: [], ...constraintTrace(normalizedRequest),
  };
  const realtimeServices = realtimeAdjustedServices(eligible, input.operations, input.realtimeRouteTime, trace);
  const delayInfo = delaysFor(realtimeServices, input.delays ?? {}, input.operations, normalizedRequest.departureTimeMinutes);
  trace.estimatedDelayTrips = [...delayInfo.values()].filter(({ delayStatus }) => delayStatus === "estimated").length;
  trace.observedDelayTrips = [...delayInfo.values()].filter(({ delayStatus, delayMinutes }) => delayStatus === "observed" && delayMinutes > 0).length;
  const servicesByStation = new Map<string, SearchService[]>();
  for (const service of realtimeServices) for (const call of service.calls.slice(0, -1)) {
    if (call.departureTimeMinutes === undefined) continue;
    const key = normalizeStation(call.stationName);
    const values = servicesByStation.get(key) ?? [];
    if (!values.includes(service)) values.push(service);
    servicesByStation.set(key, values);
  }
  const context: SearchContext = { request: normalizedRequest, servicesByStation, stationTransferMinutes, defaultTransferMinutes, delays: delayInfo, labels: new Map(), reachableStationsByLeg: reachableStations(realtimeServices, request.destinationStation, normalizedRequest.maxTransfers + 1), trace };
  const found: JourneySearchResponse["journeys"] = [];
  explore(context, normalizeStation(request.originStation), request.departureTimeMinutes, [], new Set(), found);
  const journeys = pareto(found.filter((journey) =>
    requirementsSatisfied(journey.legs, normalizedRequest) &&
    (normalizedRequest.arrivalTimeLimitMinutes === undefined ||
      journey.arrivalTimeMinutes <= normalizedRequest.arrivalTimeLimitMinutes)
  )).sort((a, b) => compareJourney(a, b, normalizedRequest)).slice(0, normalizedRequest.limit);
  trace.selectedJourneys = journeys.map((journey) => ({ departureTimeMinutes: journey.departureTimeMinutes, arrivalTimeMinutes: journey.arrivalTimeMinutes, transferCount: journey.transferCount, transferStations: journey.legs.slice(0, -1).map(({ destinationStation }) => destinationStation), transferWaitMinutes: journey.legs.slice(0, -1).map((leg, index) => journey.legs[index + 1]!.departureTimeMinutes - leg.arrivalTimeMinutes), trips: journey.legs.map(({ serviceUid }) => serviceUid) }));
  const direct = journeys.filter(({ transferCount, legs }) => transferCount === 0 && legs.length === 1).map(({ legs }) => ({ ...legs[0]!, source: "transitforge" as const, discoverySource: strategy === "direct-service-index" ? "direct-service-index" as const : "timetable-graph" as const, sourceReference: strategy }));
  return { serviceDate: request.serviceDate, originStation: request.originStation, destinationStation: request.destinationStation, searchTimeMinutes: request.departureTimeMinutes, totalMatchCount: journeys.length, transferPace: normalizedRequest.transferPace, rankingPreference: normalizedRequest.rankingPreference, maxTransfers: normalizedRequest.maxTransfers, ...responseConstraints(normalizedRequest), matches: direct, journeys, trace };
}

function explore(context: SearchContext, station: string, availableAt: number, legs: JourneySearchLeg[], used: Set<string>, found: JourneySearchResponse["journeys"]): void {
  if (legs.length > context.request.maxTransfers) return;
  const remainingLegs = context.request.maxTransfers + 1 - legs.length;
  if (!context.reachableStationsByLeg[remainingLegs]?.has(station)) return;
  for (const service of context.servicesByStation.get(station) ?? []) {
    if (used.has(service.serviceUid)) continue;
    const from = service.calls.findIndex((call) => normalizeStation(call.stationName) === station && call.departureTimeMinutes !== undefined);
    if (from < 0) continue;
    if (legs.length > 0 && station === "小田") { context.trace.labelsRejectedByNonUniqueStation += 1; continue; }
    const delay = context.delays.get(service.serviceUid) ?? { delayMinutes: 0 };
    const departure = service.calls[from]!.departureTimeMinutes! + delay.delayMinutes;
    const transfer = legs.length === 0 ? 0 : transferMinutes(service.calls[from]!.stationName, context);
    if (departure < availableAt + transfer) { context.trace.labelsRejectedByTransferTime += 1; continue; }
    for (let to = from + 1; to < service.calls.length; to += 1) {
      const destination = service.calls[to]!;
      if (destination.arrivalTimeMinutes === undefined) continue;
      const leg = toLeg(service, from, to, delay);
      const next = [...legs, leg];
      if (normalizeStation(destination.stationName) === normalizeStation(context.request.destinationStation)) found.push({ departureTimeMinutes: next[0]!.departureTimeMinutes, arrivalTimeMinutes: leg.arrivalTimeMinutes, transferCount: next.length - 1, legs: next });
      const nextStation = normalizeStation(destination.stationName);
      const nextRemainingLegs = context.request.maxTransfers + 1 - next.length;
      if (next.length <= context.request.maxTransfers && context.reachableStationsByLeg[nextRemainingLegs]?.has(nextStation) && acceptLabel(context, destination.stationName, next)) explore(context, nextStation, leg.arrivalTimeMinutes, next, new Set([...used, service.serviceUid]), found);
    }
  }
}

function reachableStations(
  services: SearchService[],
  destinationStation: string,
  maximumLegs: number,
): Array<Set<string>> {
  const result = [new Set([normalizeStation(destinationStation)])];
  for (let leg = 1; leg <= maximumLegs; leg += 1) {
    const previous = result[leg - 1]!;
    const current = new Set(previous);
    for (const service of services) {
      let reachesPreviousRound = false;
      for (let index = service.calls.length - 1; index >= 0; index -= 1) {
        const station = normalizeStation(service.calls[index]!.stationName);
        if (previous.has(station)) reachesPreviousRound = true;
        if (reachesPreviousRound) current.add(station);
      }
    }
    result.push(current);
  }
  return result;
}

function acceptLabel(context: SearchContext, station: string, legs: JourneySearchLeg[]): boolean {
  const arrival = legs.at(-1)!.arrivalTimeMinutes;
  const departure = legs[0]!.departureTimeMinutes;
  // 次の乗換候補は駅 到着時刻 乗車回数で決まる
  // 到着列車までキーへ含めると同等ラベルが大量に残り 広域探索が組合せ的に増える
  const key = `${normalizeStation(station)}:${legs.length}`;
  const labels = context.labels.get(key) ?? [];
  if (labels.some((label) => label.arrival <= arrival && label.departure >= departure)) return false;
  const retained = labels.filter((label) => !(arrival <= label.arrival && departure >= label.departure));
  retained.push({ arrival, departure });
  retained.sort((a, b) => a.arrival - b.arrival || b.departure - a.departure);
  context.labels.set(key, retained.slice(0, 8));
  return retained.slice(0, 8).some((label) => label.arrival === arrival && label.departure === departure);
}

function toLeg(service: SearchService, from: number, to: number, delay: DelayInfo): JourneySearchLeg {
  const origin = service.calls[from]!; const destination = service.calls[to]!;
  return { serviceUid: service.serviceUid, trainNumber: service.trainNumber, serviceType: service.serviceType, trainName: service.trainName, serviceDestination: service.destinationStation, originStation: origin.stationName, destinationStation: destination.stationName, departureTimeMinutes: origin.departureTimeMinutes! + delay.delayMinutes, arrivalTimeMinutes: destination.arrivalTimeMinutes! + delay.delayMinutes, scheduledDepartureTimeMinutes: origin.departureTimeMinutes!, scheduledArrivalTimeMinutes: destination.arrivalTimeMinutes!, delayMinutes: delay.delayMinutes, ...(delay.delayStatus ? { delayStatus: delay.delayStatus } : {}), ...(delay.delaySampleCount === undefined ? {} : { delaySampleCount: delay.delaySampleCount }), ...(delay.delayBasis === undefined ? {} : { delayBasis: delay.delayBasis }), stops: service.calls.slice(from, to + 1).map((call, index, calls) => ({ stationName: call.stationName, ...(index > 0 && call.arrivalTimeMinutes !== undefined ? { arrivalTimeMinutes: call.arrivalTimeMinutes + delay.delayMinutes } : {}), ...(index < calls.length - 1 && call.departureTimeMinutes !== undefined ? { departureTimeMinutes: call.departureTimeMinutes + delay.delayMinutes } : {}) })) };
}

function servicesFromIndex(index: Record<string, unknown>) {
  if (index.schema_version === "direct-service-index-v1" && isRecord(index.services)) {
    const services = Object.entries(index.services).flatMap(([id, value]) => isRecord(value) ? [serviceFromCalls(id, value)] : []);
    return { services, defaultTransferMinutes: 5, stationTransferMinutes: {}, connectionCount: services.reduce((sum, item) => sum + Math.max(0, item.calls.length - 1), 0) };
  }
  if (index.schema_version !== "timetable-connection-index-v1" || !isRecord(index.trips) || !Array.isArray(index.connections)) throw new Error("指定日の接続インデックス形式が不正です。");
  const connections = index.connections.filter(isRecord);
  const connectionsByTrip = new Map<string, Array<Record<string, unknown>>>();
  for (const connection of connections) {
    const tripId = String(connection.trip_id ?? "");
    const values = connectionsByTrip.get(tripId) ?? [];
    values.push(connection);
    connectionsByTrip.set(tripId, values);
  }
  const services = Object.entries(index.trips).flatMap(([id, value]) => {
    if (!isRecord(value)) return [];
    const edges = (connectionsByTrip.get(id) ?? [])
      .sort((a, b) => num(a.stop_sequence) - num(b.stop_sequence));
    if (!edges.length) return [];
    const calls: ServiceCall[] = [{ stationName: String(edges[0]!.from_station ?? ""), departureTimeMinutes: num(edges[0]!.departure_time_minutes) }];
    for (const edge of edges) { const previous = calls.at(-1)!; if (normalizeStation(previous.stationName) === normalizeStation(edge.from_station)) previous.departureTimeMinutes = num(edge.departure_time_minutes); calls.push({ stationName: String(edge.to_station ?? ""), arrivalTimeMinutes: num(edge.arrival_time_minutes) }); }
    return [makeService(id, value, calls)];
  });
  const stationTransferMinutes = isRecord(index.station_transfer_minutes) ? Object.fromEntries(Object.entries(index.station_transfer_minutes).map(([key, value]) => [key, nonNegative(value, 5)])) : {};
  return { services, defaultTransferMinutes: nonNegative(index.default_transfer_minutes, 5), stationTransferMinutes, connectionCount: connections.length };
}

function serviceFromCalls(id: string, value: Record<string, unknown>): SearchService {
  const calls = Array.isArray(value.calls) ? value.calls.filter(isRecord).flatMap((call) => typeof call.station_name === "string" ? [{ stationName: call.station_name, ...(typeof call.arrival_time_minutes === "number" ? { arrivalTimeMinutes: call.arrival_time_minutes } : {}), ...(typeof call.departure_time_minutes === "number" ? { departureTimeMinutes: call.departure_time_minutes } : {}) }] : []) : [];
  return makeService(id, value, calls);
}
function makeService(id: string, value: Record<string, unknown>, calls: ServiceCall[]): SearchService { return { serviceUid: String(value.service_uid ?? id), trainNumber: String(value.train_no ?? ""), serviceType: String(value.service_type ?? ""), trainName: String(value.train_name ?? ""), originStation: String(value.origin_station ?? calls[0]?.stationName ?? ""), destinationStation: String(value.destination_station ?? calls.at(-1)?.stationName ?? ""), calls }; }

function realtimeAdjustedServices(services: SearchService[], operations: Record<string, JourneyOperation> | undefined, realtime: number | undefined, trace: JourneySearchTrace): SearchService[] {
  if (!operations || realtime === undefined) return services;
  return services.flatMap((service) => {
    const operation = operationFor(service, operations);
    const first = service.calls.find(({ departureTimeMinutes }) => departureTimeMinutes !== undefined)?.departureTimeMinutes;
    const last = [...service.calls].reverse().find(({ arrivalTimeMinutes }) => arrivalTimeMinutes !== undefined)?.arrivalTimeMinutes;
    if (!operation) { if (first !== undefined && last !== undefined && first <= realtime && realtime <= last) { trace.realtimeActiveServicesRejected += 1; return []; } return [service]; }
    if (operation.sources.includes("osakaloop")) return [service];
    const destination = normalizeStation(operation.destination);
    if (!destination || destination === normalizeStation(service.destinationStation)) return [service];
    const cutoff = service.calls.findIndex((call) => normalizeStation(call.stationName) === destination);
    if (cutoff < 1) { trace.realtimeActiveServicesRejected += 1; return []; }
    return [{ ...service, destinationStation: operation.destination, calls: service.calls.slice(0, cutoff + 1) }];
  });
}

function delaysFor(services: SearchService[], legacy: Record<string, number>, operations: Record<string, JourneyOperation> | undefined, requestTime: number): Map<string, DelayInfo> {
  const result = new Map<string, DelayInfo>(); const observed: Array<{ service: SearchService; delay: number }> = [];
  for (const service of services) { const operation = operations && operationFor(service, operations); if (operation) { const delay = Math.max(0, operation.delayMinutes); result.set(service.serviceUid, { delayMinutes: delay, delayStatus: "observed" }); if (delay > 0) observed.push({ service, delay }); } else { const delay = Math.max(0, legacy[service.trainNumber] ?? 0); result.set(service.serviceUid, { delayMinutes: delay, ...(delay > 0 ? { delayStatus: "observed" as const } : {}) }); } }
  for (const candidate of services) {
    if ((operations && operationFor(candidate, operations)) || (result.get(candidate.serviceUid)?.delayMinutes ?? 0) > 0) continue;
    const anchor = candidate.calls.findIndex((call) => call.departureTimeMinutes !== undefined && call.departureTimeMinutes >= requestTime && call.departureTimeMinutes <= requestTime + 120);
    if (anchor < 0 || anchor >= candidate.calls.length - 1) continue;
    const from = normalizeStation(candidate.calls[anchor]!.stationName); const to = normalizeStation(candidate.calls[anchor + 1]!.stationName); const departure = candidate.calls[anchor]!.departureTimeMinutes!;
    const samples = observed.flatMap(({ service, delay }) => service.calls.slice(0, -1).flatMap((call, index) => normalizeStation(call.stationName) === from && normalizeStation(service.calls[index + 1]!.stationName) === to && call.departureTimeMinutes !== undefined && Math.abs(call.departureTimeMinutes + delay - departure) <= 90 ? [{ distance: Math.abs(call.departureTimeMinutes + delay - departure), delay }] : [])).sort((a, b) => a.distance - b.distance).slice(0, 3);
    if (samples.length) { const sorted = samples.map(({ delay }) => delay).sort((a, b) => a - b); const estimated = Math.min(60, sorted[Math.floor(sorted.length / 2)]!); result.set(candidate.serviceUid, { delayMinutes: estimated, delayStatus: "estimated", delaySampleCount: samples.length, delayBasis: `${candidate.calls[anchor]!.stationName}→${candidate.calls[anchor + 1]!.stationName}` }); }
  }
  return result;
}

function operationFor(service: SearchService, operations: Record<string, JourneyOperation>): JourneyOperation | undefined { return operations[service.trainNumber] ?? (service.serviceType.includes("関空快速") && service.trainNumber.endsWith("M") && operations[service.trainNumber.slice(0, -1)]?.sources.includes("osakaloop") ? operations[service.trainNumber.slice(0, -1)] : undefined); }
function transferMinutes(station: string, context: SearchContext): number { const rule = Object.entries(context.stationTransferMinutes).find(([name]) => normalizeStation(name) === normalizeStation(station)); const base = rule?.[1] ?? context.defaultTransferMinutes; const result = context.request.transferPace === "hurried" ? Math.max(2, Math.round(base * .7 * 10) / 10) : context.request.transferPace === "relaxed" ? Math.max(2, base + 5) : Math.max(2, base); if (rule) context.trace.stationTransferRulesUsed[station] = result; return result; }
function excluded(service: SearchService, request: JourneySearchRequest): boolean { return (request.excludedServiceTypes ?? []).some((v) => equal(service.serviceType, v)) || (request.excludedTrainNames ?? []).some((v) => trainNameMatches(service.trainName, v)) || (request.excludedTrainNumbers ?? []).some((v) => equal(service.trainNumber, v)) || (request.excludedServiceUids ?? []).some((v) => equal(service.serviceUid, v)); }
function allowed(service: SearchService, request: JourneySearchRequest): boolean { return !request.allowedServiceTypes?.length || request.allowedServiceTypes.some((v) => equal(service.serviceType, v)); }
function requirementsSatisfied(legs: JourneySearchLeg[], request: JourneySearchRequest): boolean { return (request.requiredServiceTypes ?? []).every((v) => legs.some((leg) => equal(leg.serviceType, v))) && (request.requiredTrainNames ?? []).every((v) => legs.some((leg) => trainNameMatches(leg.trainName, v))) && (request.requiredTrainNumbers ?? []).every((v) => legs.some((leg) => equal(leg.trainNumber, v))); }
function trainNameMatches(actual: string, wanted: string): boolean { const a = normalize(actual); const w = normalize(wanted); return /[0-9]+号$/u.test(w) ? a === w : a.replace(/[0-9]+号$/u, "") === w; }
function equal(a: string, b: string): boolean { return normalize(a) === normalize(b); }
function normalize(value: unknown): string { return String(value ?? "").normalize("NFKC").replace(/\s+/gu, ""); }
function normalizeStation(value: unknown): string { return normalize(value).replace(/駅$/u, ""); }
function pareto(values: JourneySearchResponse["journeys"]): JourneySearchResponse["journeys"] { const unique = [...new Map(values.map((journey) => [`${journey.departureTimeMinutes}:${journey.arrivalTimeMinutes}:${journey.legs.map(({ serviceUid }) => serviceUid).join(",")}`, journey])).values()]; return unique.filter((journey) => !unique.some((other) => other !== journey && other.arrivalTimeMinutes <= journey.arrivalTimeMinutes && other.departureTimeMinutes >= journey.departureTimeMinutes && other.transferCount <= journey.transferCount && (other.arrivalTimeMinutes < journey.arrivalTimeMinutes || other.departureTimeMinutes > journey.departureTimeMinutes || other.transferCount < journey.transferCount))); }
function compareJourney(a: JourneySearchResponse["journeys"][number], b: JourneySearchResponse["journeys"][number], request: NormalizedRequest): number { const score = (journey: typeof a) => { const later = Math.max(0, journey.departureTimeMinutes - request.departureTimeMinutes); if (request.rankingPreference === "earliest-arrival") return [journey.arrivalTimeMinutes, journey.transferCount, -journey.departureTimeMinutes]; if (request.rankingPreference === "fewest-transfers") return [journey.transferCount, journey.arrivalTimeMinutes, -journey.departureTimeMinutes]; if (request.rankingPreference === "latest-departure") return [journey.arrivalTimeMinutes - later * .5 + journey.transferCount * 4, journey.arrivalTimeMinutes, journey.transferCount]; return [journey.arrivalTimeMinutes + journey.transferCount * 8 - later * .25, journey.arrivalTimeMinutes, journey.transferCount]; }; const l = score(a), r = score(b); return l[0]! - r[0]! || l[1]! - r[1]! || l[2]! - r[2]!; }
const constraintNames = ["excludedServiceTypes", "excludedTrainNames", "excludedTrainNumbers", "excludedServiceUids", "requiredServiceTypes", "requiredTrainNames", "requiredTrainNumbers", "allowedServiceTypes"] as const;
function constraintTrace(request: JourneySearchRequest): Record<string, string[]> { return Object.fromEntries(constraintNames.map((name) => [name, [...(request[name] ?? [])].sort()])); }
function responseConstraints(request: JourneySearchRequest): Record<string, string[]> { return Object.fromEntries(constraintNames.map((name) => [name, [...(request[name] ?? [])]])); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function num(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("接続インデックス内の時刻形式が不正です。"); return value; }
function nonNegative(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback; }
