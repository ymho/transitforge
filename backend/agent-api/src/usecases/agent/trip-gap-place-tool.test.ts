import { expect, it } from "vitest";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import { registerServerTools } from "./server-tools.js";
import { tripGapPlaceTool } from "./trip-gap-place-tool.js";

const at = "2026-09-23T00:00:00.000Z";
const anchor: ItineraryItem = { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01" },
  place: { name: "出雲大社", area: "出雲市", coordinate: { latitude: 35.4, longitude: 132.7 }, sources: [] } };
const trip = createTrip("00000000-0000-4000-8000-000000000256", "出雲", at, [anchor,
  { id: "hotel", title: "宿", type: "activity", category: "free-time", schedule: { type: "day", date: "2026-10-01" } }]);

it("bounds provider-ranked places by retained-coordinate radius, preserving unknown distances as unverified", async () => {
  const requests: Record<string, unknown>[] = [], tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  registerServerTools(tools, evidence, [tripGapPlaceTool(trip, async request => {
    requests.push(request);
    return { body: { result: { status: "available", freshness: "fresh", data: { places: [
      { providerPlaceId: "near", name: "近くの美術館", latitude: 35.405, longitude: 132.7, openingHoursStatus: "unknown", sourceUrl: "https://www.mapbox.com/" },
      { providerPlaceId: "far", name: "遠方の美術館", latitude: 36.0, longitude: 132.7, openingHoursStatus: "unknown", sourceUrl: "https://www.mapbox.com/" },
      { providerPlaceId: "unknown", name: "位置未確認", openingHoursStatus: "unknown", sourceUrl: "https://www.mapbox.com/" },
    ] }, evidence: [{ id: "place:mapbox:1", kind: "place", provider: "mapbox", sourceUrl: "https://www.mapbox.com/", retrievedAt: at, confidence: "observed" }] } } };
  })]);
  const result = await tools.execute("search_trip_gap_places", { anchorItemId: "shrine", query: "美術館", expectedRevision: 0, radiusMeters: 2_000 }, { executionId: "turn" });
  expect(requests).toEqual([{ query: "美術館", latitude: 35.4, longitude: 132.7, limit: 5 }]);
  expect(result).toMatchObject({ ok: true, output: { result: { data: { places: [{ providerPlaceId: "near" }, { providerPlaceId: "unknown" }] } },
    searchContext: { tripId: trip.id, anchorItemId: "shrine", nextItemId: "hotel", excludedOutOfRadius: 1, unknownDistance: 1,
      spatialAssessment: "straight-line-radius-from-retained-coordinate", travelTimeVerified: false, eventScheduleVerified: false, adopted: false } } });
  if (!result.ok) throw new Error("unexpected result");
  expect(evidence.collect("search_trip_gap_places", result.output, { executionId: "turn", toolCallId: "place-1", toolName: "search_trip_gap_places",
    queryFingerprint: "museum", retrievedAt: at })).toEqual(expect.arrayContaining([
    expect.objectContaining({ subject: `trip:${trip.id}` }), expect.objectContaining({ facts: expect.objectContaining({ provider: "mapbox" }) }),
  ]));
  expect(trip.items).toHaveLength(2);
});

it("uses an area hint without falsely claiming a radius when the anchor has no coordinate", async () => {
  const noCoordinate = createTrip("00000000-0000-4000-8000-000000000257", "出雲", at, [{ ...anchor, place: { name: "出雲大社", area: "出雲市", sources: [] } }]);
  let request: Record<string, unknown> | undefined;
  const tools = new AgentToolRegistry();
  registerServerTools(tools, new ToolEvidenceRegistry(), [tripGapPlaceTool(noCoordinate, async input => {
    request = input; return { body: { result: { status: "available", freshness: "unknown", data: { places: [] }, evidence: [] } } };
  })]);
  expect(await tools.execute("search_trip_gap_places", { anchorItemId: "shrine", query: "庭園" }, { executionId: "turn" }))
    .toMatchObject({ ok: true, output: { searchContext: { spatialAssessment: "area-query-only-unverified" } } });
  expect(request).toEqual({ query: "庭園 出雲市", limit: 5 });
});

it("refuses stale, foreign or locationless anchors before a provider call", async () => {
  let calls = 0; const search = async () => { calls++; return { body: {} }; };
  const tools = new AgentToolRegistry(); registerServerTools(tools, new ToolEvidenceRegistry(), [tripGapPlaceTool(trip, search)]);
  const run = (input: unknown) => tools.execute("search_trip_gap_places", input, { executionId: "turn" });
  expect(await run({ anchorItemId: "shrine", query: "寺", tripId: "other" })).toMatchObject({ ok: false });
  expect(await run({ anchorItemId: "shrine", query: "寺", expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: "stale_revision" } });
  expect(await run({ anchorItemId: "other", query: "寺" })).toMatchObject({ ok: false, error: { code: "not_found" } });
  const locationless = createTrip("00000000-0000-4000-8000-000000000258", "未定", at, [{ ...anchor, place: undefined }]);
  const noLocation = new AgentToolRegistry(); registerServerTools(noLocation, new ToolEvidenceRegistry(), [tripGapPlaceTool(locationless, search)]);
  expect(await noLocation.execute("search_trip_gap_places", { anchorItemId: "shrine", query: "寺" }, { executionId: "turn" }))
    .toMatchObject({ ok: false, error: { code: "precondition_missing" } });
  expect(calls).toBe(0);
});
