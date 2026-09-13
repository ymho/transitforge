import { describe, expect, it } from "vitest";
import { applyTripProposal, type Trip, type TripPatch } from "./trip";
import { multiCityTrip } from "./trip-places.fixture";

function apply(trip: Trip, patches: TripPatch[]) { return applyTripProposal(trip, { tripId: trip.id, summary: "編集案", patches }); }
describe("workspace patches share atomic Trip invariants", () => {
  it("removes existing items and moves stable IDs in patch order", () => {
    const trip = multiCityTrip(), original = structuredClone(trip);
    const after = apply(trip, [{ type: "move", itemId: "activity" }, { type: "move", itemId: "movement", afterId: "hotel" }, { type: "remove", itemId: "hotel" }]);
    expect(after.items.map((i) => i.id)).toEqual(["activity", "movement"]);
    expect(after.items[0]).toEqual(trip.items[2]); expect(trip).toEqual(original);
    expect(after.revision).toBe(0);
  });
  it.each<TripPatch[]>([
    [{ type: "remove", itemId: "missing" }], [{ type: "move", itemId: "missing" }],
    [{ type: "move", itemId: "activity", afterId: "missing" }], [{ type: "move", itemId: "activity", afterId: "activity" }],
    [{ type: "remove", itemId: "hotel" }, { type: "move", itemId: "activity", afterId: "hotel" }],
    [{ type: "move", itemId: "activity" }, { type: "remove", itemId: "missing" }],
  ])("rejects invalid references atomically: %j", (...patches) => {
    const trip = multiCityTrip(), before = structuredClone(trip);
    expect(() => apply(trip, patches)).toThrow(); expect(trip).toEqual(before);
  });
  it("rejects dangling constraints/assumptions, but accepts an explicit repair in the same proposal", () => {
    const trip: Trip = { ...multiCityTrip(), request: { constraints: [{ id: "time", scope: { type: "item", itemId: "activity" }, strength: "soft", source: "user", requirement: { type: "pace", value: 0.2 } }],
      assumptions: [{ id: "maybe", text: "時間未定", source: "model", status: "unconfirmed", affects: [{ type: "item", itemId: "activity", field: "schedule" }] }] } };
    expect(() => apply(trip, [{ type: "remove", itemId: "activity" }])).toThrow();
    const after = apply(trip, [{ type: "remove", itemId: "activity" }, { type: "request", request: { constraints: [], assumptions: [] } }]);
    expect(after.items).toHaveLength(2); expect(trip.items).toHaveLength(3);
  });
  it("keeps add/replace strict and rejects unknown patch keys", () => {
    const trip = multiCityTrip();
    expect(() => apply(trip, [{ type: "add", item: trip.items[0]! }])).toThrow();
    expect(() => apply(trip, [{ type: "replace", itemId: "absent", item: trip.items[0]! }])).toThrow();
    expect(() => apply(trip, [{ type: "remove", itemId: "activity", raw: {} } as unknown as TripPatch])).toThrow();
  });
});
