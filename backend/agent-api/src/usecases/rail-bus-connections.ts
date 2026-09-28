import { normalizeStationName } from "@raiquora/train/station-name";
import type { StationLineCatalog } from "@raiquora/train/station";
import type { JourneySearchRequest, JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import type { GroundRouteProvider, GroundRoute, GroundRouteCoverage, RoutePoint } from "../ports/ground-route-provider.js";

export interface RailBusCandidate {
  station: RoutePoint;
  rail: JourneySearchResponse["journeys"][number];
  bus: GroundRoute;
  busCoverage: GroundRouteCoverage;
  busCheckedAt: string;
  railArrivalAt: string;
  transferMinutes: number;
}
export interface RailBusConnectionResult {
  status: "available" | "no_route" | "partial_unavailable" | "outside_coverage";
  candidates: RailBusCandidate[];
  stationsConsidered: string[];
  dataFailures: number;
}

/** Search multiple real catalog stations; rail and OTP must independently prove the transfer. */
export async function searchRailBusConnections(input: {
  originStation: string; destination: RoutePoint; departureAt: string;
  stationCatalog: StationLineCatalog; preferredStations?: string[];
  railSearch: (request: JourneySearchRequest) => Promise<JourneySearchResponse>;
  ground: GroundRouteProvider;
  transferMinutes?: number;
}): Promise<RailBusConnectionResult> {
  const { originStation, destination, departureAt, stationCatalog } = input;
  const transferMinutes = input.transferMinutes ?? 5;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/u.test(departureAt) || !Number.isFinite(Date.parse(departureAt)) ||
    !Number.isSafeInteger(transferMinutes) || transferMinutes < 5 || transferMinutes > 60 ||
    stationCatalog.schema_version !== "station-line-catalog-v1" || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude) ||
    Math.abs(destination.latitude) > 90 || Math.abs(destination.longitude) > 180) throw new Error("Invalid rail-bus inputs");
  const serviceDate = departureAt.slice(0, 10), departureTimeMinutes = Number(departureAt.slice(11, 13)) * 60 + Number(departureAt.slice(14, 16));
  const all = stationCatalog.lines.flatMap(line => line.stations).filter(station => valid(station.coordinate));
  // Same-name stations with distinct coordinates are ambiguous; never silently use one.
  const grouped = new Map<string, typeof all>();
  for (const station of all) { const key = normalizeStationName(station.name), values = grouped.get(key) ?? [];
    values.push(station); grouped.set(key, values); }
  const preferred = new Set((input.preferredStations ?? []).map(normalizeStationName));
  const stations = [...grouped].filter(([name, matches]) => name !== normalizeStationName(originStation) &&
    new Set(matches.map(({ coordinate }) => coordinate.join(","))).size === 1)
    .map(([name, matches]) => ({ name: matches[0]!.name, latitude: matches[0]!.coordinate[1], longitude: matches[0]!.coordinate[0],
      hint: preferred.has(name), distance: distance(destination, matches[0]!.coordinate[1], matches[0]!.coordinate[0]) }))
    .filter(station => station.distance <= 30_000)
    .sort((a, b) => Number(b.hint) - Number(a.hint) || a.distance - b.distance).slice(0, 3);
  if (!stations.length) return { status: "outside_coverage", candidates: [], stationsConsidered: [], dataFailures: 0 };
  const checked = await Promise.all(stations.map(async station => {
    try {
      const result = await input.railSearch({ originStation, destinationStation: station.name, serviceDate, departureTimeMinutes,
        limit: 2, maxTransfers: 3, rankingPreference: "earliest-arrival" });
      if (result.serviceDate !== serviceDate || normalizeStationName(result.destinationStation) !== normalizeStationName(station.name)) throw new Error("Mismatched rail result");
      const options = await Promise.all(result.journeys.slice(0, 2).map(async rail => {
        if (!rail.legs.length || rail.arrivalTimeMinutes < departureTimeMinutes || rail.arrivalTimeMinutes > 2_880 ||
            normalizeStationName(rail.legs.at(-1)!.destinationStation) !== normalizeStationName(station.name)) return { candidates: [], failure: 1, outside: 0 };
        const railArrivalAt = japaneseTime(serviceDate, rail.arrivalTimeMinutes);
        const bus = await input.ground.search({ origin: station, destination, departureAt: japaneseTime(serviceDate, rail.arrivalTimeMinutes + transferMinutes), mode: "bus" });
        if (bus.status === "unavailable") return { candidates: [], failure: 1, outside: 0 };
        if (bus.status !== "available") return { candidates: [], failure: 0, outside: Number(bus.status === "outside_coverage") };
        return { candidates: bus.routes.filter(route => Date.parse(route.departureAt) >= Date.parse(railArrivalAt) + transferMinutes * 60_000)
          .map(route => ({ station: { name: station.name, latitude: station.latitude, longitude: station.longitude },
            rail, bus: route, busCoverage: bus.coverage, busCheckedAt: bus.checkedAt, railArrivalAt, transferMinutes })), failure: 0, outside: 0 };
      }));
      return { candidates: options.flatMap(option => option.candidates), failure: options.reduce((sum, option) => sum + option.failure, 0),
        outside: options.reduce((sum, option) => sum + option.outside, 0) };
    } catch { return { candidates: [] as RailBusCandidate[], failure: 1, outside: 0 }; }
  }));
  const candidates = checked.flatMap(item => item.candidates).sort((a, b) => Date.parse(a.bus.arrivalAt) - Date.parse(b.bus.arrivalAt)).slice(0, 5);
  const dataFailures = checked.reduce((sum, item) => sum + item.failure, 0);
  const outside = checked.reduce((sum, item) => sum + item.outside, 0);
  return { status: candidates.length ? "available" : dataFailures ? "partial_unavailable" : outside ? "outside_coverage" : "no_route",
    candidates, stationsConsidered: stations.map(station => station.name), dataFailures };
}
function valid(coordinate: unknown): coordinate is [number, number] {
  return Array.isArray(coordinate) && coordinate.length === 2 && coordinate.every(Number.isFinite) &&
    Math.abs(coordinate[0]) <= 180 && Math.abs(coordinate[1]) <= 90;
}
function distance(point: RoutePoint, latitude: number, longitude: number): number {
  const rad = (v: number) => v * Math.PI / 180;
  const dLat = rad(latitude - point.latitude), dLon = rad(longitude - point.longitude);
  return 12_742_000 * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(rad(point.latitude)) * Math.cos(rad(latitude)) * Math.sin(dLon / 2) ** 2));
}
function japaneseTime(serviceDate: string, minutes: number): string {
  const millis = Date.parse(`${serviceDate}T00:00:00+09:00`) + minutes * 60_000;
  return new Date(millis + 9 * 60 * 60_000).toISOString().slice(0, 19) + "+09:00";
}
