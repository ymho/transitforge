import { expect, it } from "vitest";
import { applyTripPlanPatches, loadTripPlan, tripPlanPatchesFromTravelPlan, tripPlanStorageKey, type TripPlan } from "./trip-plan";
const plan = { version: 1, id: "p", title: "旅", destination: "出雲", updatedAt: "", items: [{ id: "a", type: "sightseeing", place: { name: "出雲大社", provider: "manual" } }] } as TripPlan;
it("applies add replace remove and move patches", () => {
  const next = applyTripPlanPatches(plan, [{ type: "add", item: { id: "b", type: "sightseeing", place: { name: "日御碕", provider: "manual" } }, afterId: "a" }, { type: "replace", itemId: "a", item: { id: "a", type: "sightseeing", place: { name: "稲佐の浜", provider: "manual" } } }]);
  expect(next.items.map((item) => item.id)).toEqual(["a", "b"]);
  expect((next.items[0] as { place: { name: string } }).place.name).toBe("稲佐の浜");
});

it("replaces searched travel sections while preserving sightseeing", () => {
  const travel = {
    destination: "城崎温泉",
    checkInDate: "2026-09-01",
    checkOutDate: "2026-09-02",
    outbound: { originStation: "京都", destinationStation: "城崎温泉", journeys: [] },
    returning: { originStation: "城崎温泉", destinationStation: "京都", journeys: [] },
    accommodations: [],
  };
  const next = applyTripPlanPatches(plan, tripPlanPatchesFromTravelPlan(travel));
  expect(next.items.some((item) => item.type === "sightseeing")).toBe(true);
  expect(next.items.find((item) => item.id === "outbound")).toMatchObject({ type: "movement" });
  expect(next.items.find((item) => item.id === "stay")).toMatchObject({ type: "stay", checkInDate: "2026-09-01" });
});

it("does not add duplicate items and upserts a searched section", () => {
  const next = applyTripPlanPatches(plan, [
    { type: "add", item: { id: "a", type: "sightseeing", place: { name: "日御碕", provider: "manual" } } },
    { type: "replace", itemId: "missing", item: { id: "missing", type: "sightseeing", place: { name: "稲佐の浜", provider: "manual" } } },
  ]);
  expect(next.items[0]).toEqual(plan.items[0]);
  expect(next.items[1]).toMatchObject({ id: "missing", type: "sightseeing" });
});

it("rejects malformed persisted trip plan items", () => {
  const storage = {
    getItem: (key: string) => key === tripPlanStorageKey
      ? JSON.stringify({ ...plan, items: [{ id: "broken", type: "movement", route: {} }] })
      : null,
  };
  expect(loadTripPlan(storage)).toBeUndefined();
});
