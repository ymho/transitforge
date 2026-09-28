import { expect, it } from "vitest";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import { registerTripSearchContextTool } from "./trip-search-context-tool.js";

const tripId = "00000000-0000-4000-8000-000000000256", at = "2026-09-23T00:00:00.000Z";
const items: ItineraryItem[] = [
  { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01" },
    place: { name: "出雲大社", area: "出雲", coordinate: { latitude: 35.4, longitude: 132.7 }, sources: [] } },
  { id: "dinner", title: "夕食", type: "activity", category: "food", schedule: { type: "relative", dayId: "second", part: "evening" } },
];
const trip = createTrip(tripId, "出雲", at, items, undefined, "itinerary_draft", undefined, { version: 1,
  logicalDays: [{ id: "second" }], calendarBindings: [] });

it("returns bounded item-order search hints without claiming time or distance, and records Trip evidence", async () => {
  const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry();
  registerTripSearchContextTool(tools, evidence, trip);
  const result = await tools.execute("get_trip_search_context", { anchorItemId: "shrine", expectedRevision: 0 }, { executionId: "turn" });
  expect(result).toMatchObject({ ok: true, output: { tripId, placement: "after_anchor_before_next_in_trip_item_order",
    anchor: { itemId: "shrine", searchPlace: { name: "出雲大社", coordinate: { latitude: 35.4, longitude: 132.7 }, provenance: "unverified-manual-snapshot" } },
    next: { itemId: "dinner", schedule: { type: "relative" } },
    constraints: { travelTimeVerified: false, freeTimeVerified: false, openingHoursVerified: false } } });
  if (!result.ok) throw new Error("unexpected tool failure");
  const facts = evidence.collect("get_trip_search_context", result.output, { executionId: "turn", toolCallId: "read-1", toolName: "get_trip_search_context",
    queryFingerprint: "shrine", retrievedAt: at });
  expect(facts).toMatchObject([{ subject: `trip:${tripId}`, facts: { anchorItemId: "shrine", nextItemId: "dinner", travelTimeVerified: false } }]);
  expect(JSON.stringify(result.output)).not.toContain("sources");
});

it("rejects stale, unknown and malformed anchors without returning unrelated Trip data", async () => {
  const tools = new AgentToolRegistry(); registerTripSearchContextTool(tools, new ToolEvidenceRegistry(), trip);
  expect(await tools.execute("get_trip_search_context", { anchorItemId: "shrine", expectedRevision: 1 }, { executionId: "turn" }))
    .toMatchObject({ ok: false, error: { code: "stale_revision" } });
  expect(await tools.execute("get_trip_search_context", { anchorItemId: "other-trip" }, { executionId: "turn" }))
    .toMatchObject({ ok: false, error: { code: "not_found" } });
  expect(await tools.execute("get_trip_search_context", { anchorItemId: "shrine", tripId: "other-trip" }, { executionId: "turn" }))
    .toMatchObject({ ok: false });
  expect(await tools.execute("get_trip_search_context", { anchorItemId: "dinner" }, { executionId: "turn" }))
    .toMatchObject({ ok: true, output: { constraints: { nextItemKnown: false } } });
});
