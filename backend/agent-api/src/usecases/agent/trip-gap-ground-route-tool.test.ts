import { expect, it } from "vitest";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { createTrip } from "@raiquora/trip/trip";
import { tripGapGroundRouteTool } from "./trip-gap-ground-route-tool.js";
import { registerServerTools } from "./server-tools.js";
import type { GroundRouteProvider } from "../../ports/ground-route-provider.js";

const at = "2026-09-28T00:00:00Z";
const trip = createTrip("00000000-0000-4000-8000-000000000756", "出雲", at, [
  { id: "shrine", title: "大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01" },
    place: { name: "出雲大社", coordinate: { latitude: 35.4, longitude: 132.7 }, sources: [] } },
  { id: "hotel", title: "宿", type: "activity", category: "free-time", schedule: { type: "day", date: "2026-10-01" },
    place: { name: "宿", coordinate: { latitude: 35.5, longitude: 132.8 }, sources: [] } },
]);

it("binds origin and default destination to owned Trip, marks times and adoption unverified", async () => {
  let input: unknown; const registry = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  const provider = { search: async (request: unknown) => { input = request; return { status: "no_route", routes: [], checkedAt: at,
    coverage: { bounds: {}, serviceStart: "2026-10-01", serviceEnd: "2026-12-31", feedUrl: "https://example.org/gtfs.zip",
      feedRetrievedAt: at, graphBuiltAt: at, attribution: "Example" } }; } } as unknown as GroundRouteProvider;
  registerServerTools(registry, evidence, [tripGapGroundRouteTool(trip, provider)]);
  const result = await registry.execute("search_trip_gap_ground_routes", { anchorItemId: "shrine", departureAt: "2026-10-01T09:00:00+09:00", mode: "bus" }, { executionId: "turn" });
  expect(input).toMatchObject({ origin: { name: "出雲大社", latitude: 35.4 }, destination: { name: "宿", latitude: 35.5 } });
  expect(result).toMatchObject({ ok: true, output: { searchContext: { tripId: trip.id, destinationSource: "unverified-manual-snapshot", tripScheduleVerified: false, adopted: false }, groundRoutes: { status: "no_route" } } });
  if (!result.ok) throw new Error("expected route result");
  expect(evidence.collect("search_trip_gap_ground_routes", result.output, { executionId: "turn", toolCallId: "1", toolName: "search_trip_gap_ground_routes", queryFingerprint: "bus", retrievedAt: at }))
    .toMatchObject([{ facts: { status: "no_route", adopted: false }, references: [{ sourceRef: "https://example.org/gtfs.zip" }] }]);
  expect(trip.items).toHaveLength(2);
  expect(await registry.execute("search_trip_gap_ground_routes", { anchorItemId: "shrine", expectedRevision: 5, departureAt: "2026-10-01T09:00:00+09:00", mode: "bus" }, { executionId: "turn" }))
    .toMatchObject({ ok: false, error: { code: "stale_revision" } });
  expect(await registry.execute("search_trip_gap_ground_routes", { anchorItemId: "other", departureAt: "2026-10-01T09:00:00+09:00", mode: "bus" }, { executionId: "turn" }))
    .toMatchObject({ ok: false, error: { code: "not_found" } });
});

it("compares known Trip time bounds but never treats a candidate detour as reaching the next item", async () => {
  const fixed = createTrip("00000000-0000-4000-8000-000000000757", "出雲", at, [
    { ...trip.items[0]!, schedule: { type: "fixed", startAt: { at: "2026-10-01T08:00:00+09:00", timeZone: "Asia/Tokyo" },
      endAt: { at: "2026-10-01T09:00:00+09:00", timeZone: "Asia/Tokyo" } } },
    { ...trip.items[1]!, schedule: { type: "fixed", startAt: { at: "2026-10-01T09:40:00+09:00", timeZone: "Asia/Tokyo" } } },
  ]);
  const registry = new AgentToolRegistry();
  const provider = { search: async () => ({ status: "available", checkedAt: at, coverage: {
    bounds: {}, serviceStart: "2026-10-01", serviceEnd: "2026-12-31", feedUrl: "https://example.org/gtfs.zip",
    feedRetrievedAt: at, graphBuiltAt: at, attribution: "Example" }, routes: [{
    departureAt: "2026-10-01T09:05:00+09:00", arrivalAt: "2026-10-01T09:45:00+09:00", durationMinutes: 40, legs: [],
  }] }) } as unknown as GroundRouteProvider;
  registerServerTools(registry, new ToolEvidenceRegistry(), [tripGapGroundRouteTool(fixed, provider)]);
  const run = (extra: object) => registry.execute("search_trip_gap_ground_routes", {
    anchorItemId: "shrine", departureAt: "2026-10-01T09:05:00+09:00", mode: "bus", ...extra,
  }, { executionId: "turn" });
  expect(await run({})).toMatchObject({ ok: true, output: { searchContext: { tripScheduleVerified: true,
    routeScheduleAssessments: ["arrives_after_next_deadline"] } } });
  expect(await run({ destination: { name: "寄り道", latitude: 35.45, longitude: 132.75 } }))
    .toMatchObject({ ok: true, output: { searchContext: { tripScheduleVerified: false,
      routeScheduleAssessments: ["insufficient_schedule"] } } });
});

it("searches candidate-to-next after an explicit stay, using the next mode and comparing the known deadline", async () => {
  const requests: unknown[] = [];
  const provider = { search: async (request: { departureAt: string }) => { requests.push(request); return { status: "available", checkedAt: at,
    coverage: { bounds: {}, serviceStart: "2026-10-01", serviceEnd: "2026-12-31", feedUrl: "https://example.org/gtfs.zip",
      feedRetrievedAt: at, graphBuiltAt: at, attribution: "Example" }, routes: [{
      departureAt: request.departureAt, arrivalAt: new Date(Date.parse(request.departureAt) + 20 * 60_000).toISOString(), durationMinutes: 20, legs: [],
    }] }; } } as unknown as GroundRouteProvider;
  const fixed = createTrip("00000000-0000-4000-8000-000000000758", "出雲", at, [
    { ...trip.items[0]!, schedule: { type: "fixed", startAt: { at: "2026-10-01T08:00:00+09:00", timeZone: "Asia/Tokyo" },
      endAt: { at: "2026-10-01T09:00:00+09:00", timeZone: "Asia/Tokyo" } } },
    { ...trip.items[1]!, schedule: { type: "fixed", startAt: { at: "2026-10-01T10:30:00+09:00", timeZone: "Asia/Tokyo" } } },
  ]);
  const registry = new AgentToolRegistry(); registerServerTools(registry, new ToolEvidenceRegistry(), [tripGapGroundRouteTool(fixed, provider)]);
  const base = { anchorItemId: "shrine", departureAt: "2026-10-01T09:05:00+09:00", mode: "walk", checkNext: true,
    nextMode: "bus", destination: { name: "食事候補", latitude: 35.45, longitude: 132.75 } };
  expect(await registry.execute("search_trip_gap_ground_routes", base, { executionId: "turn" }))
    .toMatchObject({ ok: false, error: { code: "precondition_missing" } });
  const result = await registry.execute("search_trip_gap_ground_routes", { ...base, candidateStayMinutes: 45 }, { executionId: "turn" });
  expect(requests).toHaveLength(2);
  expect(requests).toMatchObject([{ origin: { name: "出雲大社" }, destination: { name: "食事候補" }, mode: "walk" },
    { origin: { name: "食事候補" }, destination: { name: "宿" }, mode: "bus", departureAt: "2026-10-01T10:10:00+09:00" }]);
  expect(result).toMatchObject({ ok: true, output: { searchContext: { tripScheduleVerified: false,
    continuation: [{ requestedCandidateStayMinutes: 45, result: { status: "available" }, scheduleAssessments: ["fits_next_deadline"] }],
    candidateStayBasis: "unverified-planning-assumption", adopted: false } } });
});
