import { expect, it } from "vitest";
import {
  applyTripPlanPatches,
  loadTripPlan,
  migrateLegacyTripPlan,
  saveTripPlan,
  tripPlanFromTravelPlan,
  tripPlanPatchesFromTravelPlan,
  tripPlanStorageKey,
  type TripPlan,
} from "./trip-plan";
const plan = { version: 1, id: "p", title: "旅", destination: "出雲", updatedAt: "", items: [{ id: "a", type: "sightseeing", place: { name: "出雲大社", provider: "manual" } }] } as TripPlan;

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
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
  const next = tripPlanFromTravelPlan(travel, new Date("2026-08-24T00:00:00Z"));
  expect(next.conditions).toEqual({
    adults: 2,
    children: 1,
    considerations: ["早朝を避ける"],
  });
});

it("loads valid trip conditions and rejects invalid traveler counts", () => {
  const conditions = { adults: 2, children: 0, considerations: ["乗換を少なめにする"] };
  const validStorage = memoryStorage();
  const invalidStorage = memoryStorage();
  saveTripPlan(validStorage, "session-valid", { ...plan, conditions });
  invalidStorage.setItem("transitforge.trip-plans.v2", JSON.stringify({
    version: 2,
    plansBySessionId: {
      "session-invalid": { ...plan, conditions: { ...conditions, adults: 30 } },
    },
  }));
  expect(loadTripPlan(validStorage, "session-valid")?.conditions).toEqual(conditions);
  expect(loadTripPlan(invalidStorage, "session-invalid")).toBeUndefined();
});

it("rejects malformed persisted trip plan items", () => {
  const storage = memoryStorage({
    "transitforge.trip-plans.v2": JSON.stringify({
      version: 2,
      plansBySessionId: {
        session: { ...plan, items: [{ id: "broken", type: "movement", route: {} }] },
      },
    }),
  });
  expect(loadTripPlan(storage, "session")).toBeUndefined();
});

it("keeps exactly one independent trip plan for each conversation UUID", () => {
  const storage = memoryStorage();
  saveTripPlan(storage, "conversation-a", plan);
  saveTripPlan(storage, "conversation-b", {
    ...plan,
    id: "p-b",
    title: "城崎の旅",
    destination: "城崎温泉",
  });
  saveTripPlan(storage, "conversation-a", {
    ...plan,
    title: "出雲をゆっくり巡る旅",
  });

  expect(loadTripPlan(storage, "conversation-a")?.title).toBe("出雲をゆっくり巡る旅");
  expect(loadTripPlan(storage, "conversation-b")?.title).toBe("城崎の旅");
});

it("moves the legacy single trip plan into the current conversation once", () => {
  const storage = memoryStorage({ [tripPlanStorageKey]: JSON.stringify(plan) });

  expect(migrateLegacyTripPlan(storage, "current-session")).toEqual(plan);
  expect(loadTripPlan(storage, "current-session")).toEqual(plan);
  expect(storage.getItem(tripPlanStorageKey)).toBeNull();
  expect(migrateLegacyTripPlan(storage, "another-session")).toBeUndefined();
});
