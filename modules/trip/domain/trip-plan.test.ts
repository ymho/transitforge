import { expect, it } from "vitest";

import {
  applyTripPlanPatches,
  tripPlanFromTravelPlan,
  tripPlanPatchesFromTravelPlan,
  type TripPlan,
} from "./trip-plan";

const plan = {
  version: 1,
  id: "p",
  title: "旅",
  destination: "出雲",
  updatedAt: "",
  items: [{
    id: "a",
    type: "sightseeing",
    place: { name: "出雲大社", provider: "manual" },
  }],
} as TripPlan;

it("applies add replace remove and move patches", () => {
  const next = applyTripPlanPatches(plan, [
    {
      type: "add",
      item: {
        id: "b",
        type: "sightseeing",
        place: { name: "日御碕", provider: "manual" },
      },
      afterId: "a",
    },
    {
      type: "replace",
      itemId: "a",
      item: {
        id: "a",
        type: "sightseeing",
        place: { name: "稲佐の浜", provider: "manual" },
      },
    },
  ]);
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
  expect(next.items.find((item) => item.id === "stay")).toMatchObject({
    type: "stay",
    checkInDate: "2026-09-01",
  });
});

it("does not add duplicate items and upserts a searched section", () => {
  const next = applyTripPlanPatches(plan, [
    {
      type: "add",
      item: { id: "a", type: "sightseeing", place: { name: "日御碕", provider: "manual" } },
    },
    {
      type: "replace",
      itemId: "missing",
      item: { id: "missing", type: "sightseeing", place: { name: "稲佐の浜", provider: "manual" } },
    },
  ]);
  expect(next.items[0]).toEqual(plan.items[0]);
  expect(next.items[1]).toMatchObject({ id: "missing", type: "sightseeing" });
});

it("stores trip-specific traveler counts and considerations as metadata", () => {
  const next = applyTripPlanPatches(plan, [{
    type: "metadata",
    conditions: {
      adults: 2,
      children: 1,
      considerations: ["早朝を避ける", "歩く時間を短めにする"],
    },
  }]);
  expect(next.conditions).toEqual({
    adults: 2,
    children: 1,
    considerations: ["早朝を避ける", "歩く時間を短めにする"],
  });
});

it("regenerates the persisted title without changing itinerary items", () => {
  const next = applyTripPlanPatches(plan, [{
    type: "metadata",
    title: "神話と海辺をたどる旅",
  }]);
  expect(next.title).toBe("神話と海辺をたどる旅");
  expect(next.items).toEqual(plan.items);
});

it("copies explicit search conditions into a new trip plan", () => {
  const travel = {
    destination: "出雲",
    adults: 2,
    children: 1,
    considerations: ["早朝を避ける"],
    checkInDate: "2026-09-01",
    checkOutDate: "2026-09-02",
    outbound: { originStation: "京都", destinationStation: "出雲市", journeys: [] },
    returning: { originStation: "出雲市", destinationStation: "京都", journeys: [] },
    accommodations: [],
  };
  const next = tripPlanFromTravelPlan(
    travel,
    new Date("2026-08-24T00:00:00Z"),
  );
  expect(next.conditions).toEqual({
    adults: 2,
    children: 1,
    considerations: ["早朝を避ける"],
  });
});
