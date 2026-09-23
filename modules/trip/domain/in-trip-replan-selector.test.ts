import { describe, expect, it } from "vitest";
import { calculateInTripReplanScope } from "./in-trip-replan";
import { createTrip, type Trip } from "./trip";

describe("day and segment replan selector", () => {
  it("resolves the complete server-side day scope without changing unrelated days", () => {
    const base = createTrip("11111111-1111-4111-8111-111111111111", "long", "2026-09-01T00:00:00Z", [], { constraints: [], assumptions: [] }, "inspiration",
      undefined, { version: 1, logicalDays: [{ id: "day-1" }, { id: "day-20" }], calendarBindings: [] });
    const trip: Trip = { ...base, lifecycleState: "in_trip", items: [
      { id: "day1-item", logicalDayId: "day-1", type: "activity", title: "day1", category: "free-time", schedule: { type: "relative", dayId: "day-1" } },
      ...Array.from({ length: 12 }, (_, index) => ({ id: `day20-${index}`, logicalDayId: "day-20", type: "activity" as const, title: `day20-${index}`, category: "free-time" as const, schedule: { type: "relative" as const, dayId: "day-20" } })),
    ] };
    const result = calculateInTripReplanScope(trip, { now: new Date("2026-09-23T00:00:00Z"), reservations: [],
      targets: { tripId: trip.id, baseRevision: trip.revision, itemIds: [], dayRefs: ["day-20"] } });
    expect(result.mutableItemIds).toHaveLength(12); expect(result.immutableProtectedItemIds).toContain("day1-item");
  });
});
