import { expect, it } from "vitest";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { railBusConnectionTool } from "./rail-bus-connection-tool.js";
import { registerServerTools } from "./server-tools.js";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import type { GroundRouteProvider } from "../../ports/ground-route-provider.js";

it("uses a trusted catalog, verifies the rail/OTP transfer and exposes bounded source evidence", async () => {
  const catalog = { schema_version: "station-line-catalog-v1" as const, source: "catalog:fixture", lines: [{ operator: "JR", line: "山陰線", stations: [
    { name: "松江", coordinate: [133.05, 35.46] as [number, number] }, { name: "出雲市", coordinate: [132.76, 35.36] as [number, number] },
  ] }] };
  const journey: JourneySearchResponse = { serviceDate: "2026-10-01", originStation: "松江", destinationStation: "出雲市", searchTimeMinutes: 480, totalMatchCount: 1,
    matches: [], journeys: [{ departureTimeMinutes: 480, arrivalTimeMinutes: 555, transferCount: 0,
      legs: [{ serviceUid: "rail", trainNumber: "1", serviceType: "普通", trainName: "普通", originStation: "松江", destinationStation: "出雲市",
        departureTimeMinutes: 480, arrivalTimeMinutes: 555, scheduledDepartureTimeMinutes: 480, scheduledArrivalTimeMinutes: 555, delayMinutes: 0 }] }] };
  const coverage = { bounds: { south: 35, north: 36, west: 132, east: 134 }, serviceStart: "2026-10-01", serviceEnd: "2026-10-31",
    feedUrl: "https://example.org/gtfs.zip", feedRetrievedAt: "2026-09-28T00:00:00Z", graphBuiltAt: "2026-09-28T01:00:00Z", attribution: "Fixture" };
  const ground = { search: async () => ({ status: "available", coverage, checkedAt: "2026-09-28T02:00:00Z", routes: [{
    departureAt: "2026-10-01T09:30:00+09:00", arrivalAt: "2026-10-01T10:10:00+09:00", durationMinutes: 40,
    legs: [{ mode: "bus", from: "駅", to: "目的地", departureAt: "2026-10-01T09:30:00+09:00", arrivalAt: "2026-10-01T10:10:00+09:00",
      distanceMeters: 500, geometry: [[132.76, 35.36], [132.7, 35.4]] }] }] }) } as unknown as GroundRouteProvider;
  const registry = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  registerServerTools(registry, evidence, [railBusConnectionTool({ load: async () => catalog }, async request => {
    expect(request).toMatchObject({ contractVersion: "journey-search-v1", destinationStation: "出雲市", serviceDate: "2026-10-01" });
    return { body: journey as unknown as Record<string, unknown> };
  }, ground)]);
  const result = await registry.execute("search_rail_bus_connections", { originStation: "松江", destination: { name: "出雲大社", latitude: 35.4, longitude: 132.7 },
    departureAt: "2026-10-01T08:00:00+09:00" }, { executionId: "turn" });
  expect(result).toMatchObject({ ok: true, output: { railBusConnections: { status: "available", candidates: [{ station: { name: "出雲市" } }] }, adopted: false } });
  if (!result.ok) throw new Error("Unexpected result");
  expect(JSON.stringify(result.output)).not.toContain("geometry");
  expect(evidence.collect("search_rail_bus_connections", result.output, { executionId: "turn", toolCallId: "1", toolName: "search_rail_bus_connections",
    queryFingerprint: "rail-bus", retrievedAt: "2026-09-28T02:00:00Z" })).toMatchObject([{ facts: { status: "available", adopted: false },
    references: [{ sourceRef: "catalog:fixture" }, { sourceRef: "https://example.org/gtfs.zip" }] }]);
});
