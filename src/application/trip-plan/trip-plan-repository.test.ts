import { expect, it } from "vitest";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import {
  loadTripPlan,
  migrateLegacyTripPlan,
  saveTripPlan,
  tripPlanStorageKey,
} from "./trip-plan-repository";
const plan = { version: 1, id: "p", title: "旅", destination: "出雲", updatedAt: "", items: [{ id: "a", type: "sightseeing", place: { name: "出雲大社", provider: "manual" } }] } as TripPlan;

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
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
