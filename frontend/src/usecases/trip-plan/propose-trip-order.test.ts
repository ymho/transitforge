import { expect, it } from "vitest";
import { createTrip, applyTripProposal } from "@raiquora/trip/trip";
import { placeActivity, placeTransport, placeStay, placesAt, placesTripId } from "../../../../modules/trip/domain/trip-places.fixture";
import { proposeTripOrder, tripOrderDays, tripOrderDay } from "./propose-trip-order";
import { orderTrip } from "./propose-trip-order.fixture";

it("rejects missing, duplicate and foreign IDs and skips unchanged order", () => {
  const trip = orderTrip(), ids = trip.items.map(item => item.id);
  expect(proposeTripOrder(trip, ids)).toBeUndefined();
  expect(() => proposeTripOrder(trip, ids.slice(1))).toThrow();
  expect(() => proposeTripOrder(trip, ["a", "a", "c"])).toThrow();
  expect(() => proposeTripOrder(trip, ["foreign", "b", "c"])).toThrow();
});
it("clears only the explicitly moved item's times and preserves dates and neighbours", () => {
  const trip = orderTrip();
  const after = applyTripProposal(trip, proposeTripOrder(trip, ["b", "a", "c"], [{ itemId: "a", dayKey: tripOrderDay(trip, "a") }])!);
  expect(after.items.map(i => i.id)).toEqual(["b", "a", "c"]);
  expect(after.items[1]!.schedule).toEqual({ type: "day", date: "2026-09-22", timeZone: "Asia/Tokyo" });
  expect(after.items[0]).toEqual(trip.items[1]); expect(after.items[2]).toEqual(trip.items[2]);
  expect(trip.items[0]!.schedule.type).toBe("fixed");
});
it("supports cross-day moves and date-only changes without a reorder", () => {
  const trip = orderTrip(), dayKey = tripOrderDay(trip, "c");
  for (const order of [["b", "c", "a"], ["a", "b", "c"]]) {
    const after = applyTripProposal(trip, proposeTripOrder(trip, order, [{ itemId: "a", dayKey }])!);
    expect(after.items.find(i => i.id === "a")!.schedule).toEqual({ type: "day", date: "2026-09-23", timeZone: "Asia/Tokyo" });
  }
});
it("locks transport and refuses undeclared moves or adopted stay date changes", () => {
  const trip = createTrip(placesTripId, "予定", placesAt, [placeTransport("rail", "A", "B"), placeStay("stay", "宿"), placeActivity("a")]);
  expect(() => proposeTripOrder(trip, ["stay", "rail", "a"], [{ itemId: "rail", dayKey: "unscheduled" }])).toThrow();
  expect(() => proposeTripOrder(trip, ["stay", "rail", "a"])).toThrow();
  expect(() => proposeTripOrder(trip, ["rail", "stay", "a"], [{ itemId: "stay", dayKey: "unscheduled" }])).toThrow();
});
it("uses logical day labels instead of exposing internal IDs", () => {
  const trip = { ...orderTrip(), schemaVersion: 3 as const, timeline: { version: 1 as const, logicalDays: [{ id: "day-1" }], calendarBindings: [] } };
  expect(tripOrderDays(trip).find(d => d.key.includes("day-1"))?.label).toBe("1日目");
});
