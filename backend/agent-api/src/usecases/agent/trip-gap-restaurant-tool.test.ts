import { expect, it } from "vitest";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import { registerServerTools } from "./server-tools.js";
import { tripGapRestaurantTool } from "./trip-gap-restaurant-tool.js";

const at = "2026-09-23T00:00:00.000Z";
const anchor: ItineraryItem = { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01" },
  place: { name: "出雲大社", area: "出雲", coordinate: { latitude: 35.4, longitude: 132.7 }, sources: [] } };
const next: ItineraryItem = { id: "hotel", title: "宿", type: "stay", selection: { status: "unselected", place: { name: "出雲駅付近", area: "出雲市", sources: [] } },
  schedule: { type: "day", date: "2026-10-01" } };
const trip = createTrip("00000000-0000-4000-8000-000000000256", "出雲", at, [anchor, next]);

it("searches around the retained Trip anchor, leaves the Trip untouched, and does not claim proximity to the next stop", async () => {
  const requests: Record<string, unknown>[] = [];
  const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  registerServerTools(tools, evidence, [tripGapRestaurantTool(trip, async request => {
    requests.push(request);
    return { body: { restaurants: { status: "available", freshness: "fresh", data: { area: "出雲", restaurants: [{
      providerRestaurantId: "r-1", name: "夕食候補", latitude: 35.4, longitude: 132.7, detailUrl: "https://example.com/restaurant",
    }] }, evidence: [{ id: "restaurant:r-1", kind: "restaurant", provider: "hot-pepper", sourceUrl: "https://example.com/restaurant",
      retrievedAt: at, confidence: "observed" }] } } };
  })]);
  const result = await tools.execute("search_trip_gap_restaurants", { anchorItemId: "shrine", expectedRevision: 0, keyword: "そば", limit: 5 }, { executionId: "turn" });
  expect(requests).toEqual([{ area: "出雲", latitude: 35.4, longitude: 132.7, range: 3, keyword: "そば", limit: 5 }]);
  expect(result).toMatchObject({ ok: true, output: { searchContext: { tripId: trip.id, sourceRevision: 0, anchorItemId: "shrine", nextItemId: "hotel",
    center: { source: "unverified-manual-snapshot" }, nextPlace: { name: "出雲駅付近" },
    evaluation: "candidates-near-anchor-only; distance-to-next-and-travel-time-unverified" },
    restaurants: { status: "available", data: { restaurants: [{ name: "夕食候補" }] } } } });
  expect(trip.items).toHaveLength(2);
  if (!result.ok) throw new Error("unexpected search failure");
  expect(evidence.collect("search_trip_gap_restaurants", result.output, { executionId: "turn", toolCallId: "search-1",
    toolName: "search_trip_gap_restaurants", queryFingerprint: "shrine", retrievedAt: at }))
    .toEqual(expect.arrayContaining([expect.objectContaining({ subject: `trip:${trip.id}` }),
      expect.objectContaining({ facts: expect.objectContaining({ provider: "hot-pepper" }) })]));
});

it("never calls the provider for another Trip, stale revisions, or missing search context", async () => {
  let calls = 0;
  const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  registerServerTools(tools, evidence, [tripGapRestaurantTool(trip, async () => { calls++; return { body: {} }; })]);
  const run = (input: unknown) => tools.execute("search_trip_gap_restaurants", input, { executionId: "turn" });
  expect(await run({ anchorItemId: "shrine", tripId: "different" })).toMatchObject({ ok: false });
  expect(await run({ anchorItemId: "shrine", expectedRevision: 1 })).toMatchObject({ ok: false, error: { code: "stale_revision" } });
  expect(await run({ anchorItemId: "foreign" })).toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(calls).toBe(0);
  const withoutPlace = createTrip("00000000-0000-4000-8000-000000000257", "未定", at, [{ ...anchor, place: undefined }]);
  const noLocation = new AgentToolRegistry();
  registerServerTools(noLocation, new ToolEvidenceRegistry(), [tripGapRestaurantTool(withoutPlace, async () => { calls++; return { body: {} }; })]);
  expect(await noLocation.execute("search_trip_gap_restaurants", { anchorItemId: "shrine" }, { executionId: "turn" }))
    .toMatchObject({ ok: false, error: { code: "precondition_missing" } });
  expect(calls).toBe(0);
});

it("returns provider partial failure without fabricating candidates or Trip adoption", async () => {
  const tools = new AgentToolRegistry();
  registerServerTools(tools, new ToolEvidenceRegistry(), [tripGapRestaurantTool(trip, async () => ({ body: { restaurants: {
    status: "unavailable", freshness: "unknown", evidence: [], failure: { code: "unavailable", message: "検索できません", retryable: true },
  } } }))]);
  expect(await tools.execute("search_trip_gap_restaurants", { anchorItemId: "shrine" }, { executionId: "turn" }))
    .toMatchObject({ ok: true, output: { restaurants: { status: "unavailable" }, searchContext: { anchorItemId: "shrine", resultCoverage: "unavailable_or_unknown" } } });
});

it("distinguishes zero results in a limited successful search from a provider failure", async () => {
  const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  registerServerTools(tools, evidence, [tripGapRestaurantTool(trip, async () => ({ body: { restaurants: {
    status: "available", freshness: "fresh", data: { area: "出雲", restaurants: [] }, evidence: [],
  } } }))]);
  const result = await tools.execute("search_trip_gap_restaurants", { anchorItemId: "shrine" }, { executionId: "turn" });
  expect(result).toMatchObject({ ok: true, output: { searchContext: { resultCoverage: "no_candidates_in_limited_response", returnedCandidateCount: 0 } } });
  if (!result.ok) throw new Error("unexpected search failure");
  expect(evidence.collect("search_trip_gap_restaurants", result.output, { executionId: "turn", toolCallId: "search-1",
    toolName: "search_trip_gap_restaurants", queryFingerprint: "shrine", retrievedAt: at }))
    .toEqual(expect.arrayContaining([expect.objectContaining({ facts: expect.objectContaining({ resultCoverage: "no_candidates_in_limited_response", returnedCandidateCount: 0 }) })]));
});

it("keeps dining candidates when the weather provider fails", async () => {
  const tools = new AgentToolRegistry();
  registerServerTools(tools, new ToolEvidenceRegistry(), [tripGapRestaurantTool(trip, async () => ({ body: { restaurants: {
    status: "available", freshness: "fresh", evidence: [], data: { area: "出雲", restaurants: [{ providerRestaurantId: "r-1", name: "夕食候補" }] },
  } } }), { search: async () => { throw new Error("network"); } })]);
  expect(await tools.execute("search_trip_gap_restaurants", { anchorItemId: "shrine" }, { executionId: "turn" }))
    .toMatchObject({ ok: true, output: { restaurants: { status: "available", data: { restaurants: [{ providerRestaurantId: "r-1" }] } },
      weatherContext: { status: "unavailable", reason: "provider_failed", forecastUsedForRanking: false } } });
});
