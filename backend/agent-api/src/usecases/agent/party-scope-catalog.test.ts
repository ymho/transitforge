import { expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { partyScopeCatalog } from "./party-scope-catalog.js";
import { resolvePartyCohorts } from "@raiquora/trip/party-cohorts";

it("derives day and authored segment choices from the same revision, not labels or raw model IDs", () => {
  const base = createTrip("72900000-0000-4000-8000-000000000001", "旅", "2026-09-27T00:00:00Z", [
    { id: "activity", title: "美術館", type: "activity", category: "sightseeing", schedule: { type: "relative", dayId: "day-b" } },
  ], undefined, undefined, undefined, { version: 1, logicalDays: [{ id: "day-a" }, { id: "day-b", label: "後半" }], calendarBindings: [] });
  const trip = { ...base, structureIntent: { version: 1 as const, relations: [], authoredSegments: [{ segmentId: "museum-segment", anchorItemIds: ["activity"] }] } };
  const catalog = partyScopeCatalog(trip);
  expect(catalog.days).toEqual([{ id: "day-a", label: "1日目" }, { id: "day-b", label: "後半" }]);
  expect(catalog.segments).toEqual([{ id: "museum-segment", label: "美術館" }]);
  expect(resolvePartyCohorts([{ count: 1, membership: "additional", scope: { kind: "segment", segmentNumber: 1 } }], catalog)[0]?.scope)
    .toEqual({ kind: "segment", tripId: "72900000-0000-4000-8000-000000000001", tripRevision: 0, segmentId: "museum-segment" });
});
