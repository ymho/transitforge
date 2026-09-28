import { expect, it } from "vitest";
import type { StationLineCatalog } from "@raiquora/train/station";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import type { GroundRouteProvider } from "../ports/ground-route-provider.js";
import { searchRailBusConnections } from "./rail-bus-connections.js";

const catalog: StationLineCatalog = { schema_version: "station-line-catalog-v1", source: "catalog:fixture", lines: [{ operator: "JR", line: "山陰線", stations: [
  { name: "松江", coordinate: [133.05, 35.46] }, { name: "出雲市", coordinate: [132.76, 35.36] },
  { name: "一畑口", coordinate: [132.88, 35.42] }, { name: "大社前", coordinate: [132.69, 35.4] },
] }] };
const destination = { name: "出雲大社", longitude: 132.685, latitude: 35.4 };
function rail(station: string, arrivalTimeMinutes: number): JourneySearchResponse {
  return { serviceDate: "2026-10-01", originStation: "松江", destinationStation: station, searchTimeMinutes: 480,
    totalMatchCount: 1, matches: [], journeys: [{ departureTimeMinutes: 480, arrivalTimeMinutes, transferCount: 0,
      legs: [{ serviceUid: "rail:1", trainNumber: "1", serviceType: "普通", trainName: "普通", originStation: "松江", destinationStation: station,
        departureTimeMinutes: 480, arrivalTimeMinutes, scheduledDepartureTimeMinutes: 480, scheduledArrivalTimeMinutes: arrivalTimeMinutes, delayMinutes: 0 }] }] };
}
const coverage = { bounds: { south: 35, north: 36, west: 132, east: 134 }, serviceStart: "2026-10-01", serviceEnd: "2026-10-31",
  feedUrl: "https://example.org/gtfs.zip", feedRetrievedAt: "2026-09-28T00:00:00Z", graphBuiltAt: "2026-09-28T01:00:00Z", attribution: "Fixture" };

it("checks multiple catalog stations and keeps only physically timed rail→bus transfers", async () => {
  const railCalls: string[] = [], busCalls: Array<{ name: string; departureAt: string }> = [];
  const result = await searchRailBusConnections({ originStation: "松江", destination, departureAt: "2026-10-01T08:00:00+09:00",
    stationCatalog: catalog, preferredStations: ["出雲市"], railSearch: async request => {
      railCalls.push(request.destinationStation); return rail(request.destinationStation, request.destinationStation === "出雲市" ? 555 : 560);
    }, ground: { search: async request => { busCalls.push({ name: request.origin.name, departureAt: request.departureAt });
      return { status: "available", checkedAt: "2026-09-28T01:00:00Z", coverage, routes: [{
        departureAt: request.origin.name === "出雲市" ? "2026-10-01T09:55:00+09:00" : "2026-10-01T09:30:00+09:00",
        arrivalAt: request.origin.name === "出雲市" ? "2026-10-01T10:20:00+09:00" : "2026-10-01T09:50:00+09:00",
        durationMinutes: 30, legs: [] }] }; } } as GroundRouteProvider });
  expect(railCalls).toContain("出雲市");
  expect(railCalls.length).toBeGreaterThan(1);
  expect(busCalls).toContainEqual({ name: "出雲市", departureAt: "2026-10-01T09:20:00+09:00" });
  expect(result.status).toBe("available");
  expect(result.candidates[0]?.bus.arrivalAt).toBe("2026-10-01T09:50:00+09:00");
});

it("keeps feed outages distinct from searched zero routes and refuses ambiguous stations", async () => {
  const ambiguous: StationLineCatalog = { ...catalog, lines: [{ ...catalog.lines[0]!, stations: [...catalog.lines[0]!.stations,
    { name: "出雲市", coordinate: [132.77, 35.37] }] }] };
  const railSearch = async (request: { destinationStation: string }) => rail(request.destinationStation, 550);
  const base = { originStation: "松江", destination, departureAt: "2026-10-01T08:00:00+09:00", stationCatalog: ambiguous, railSearch };
  const unavailable = await searchRailBusConnections({ ...base, ground: { search: async () => ({ status: "unavailable", reason: "offline", coverage }) } });
  expect(unavailable.status).toBe("partial_unavailable");
  expect(unavailable.stationsConsidered).not.toContain("出雲市");
  const noRoute = await searchRailBusConnections({ ...base, ground: { search: async () => ({ status: "no_route", routes: [], checkedAt: "2026-09-28T01:00:00Z", coverage }) } });
  expect(noRoute.status).toBe("no_route");
});
