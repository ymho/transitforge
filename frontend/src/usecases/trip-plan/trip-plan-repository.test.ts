import { expect, it } from "vitest";
import type { SightseeingPlanItem, TripPlan } from "@raiquora/trip/trip-plan";
import {
  loadTripPlan,
  migrateLegacyTripPlan,
  saveTripPlan,
  tripPlanStorageKey,
  tripPlanStoreStorageKey,
} from "./trip-plan-repository";
const plan = { version: 1, id: "p", title: "旅", destination: "出雲", updatedAt: "", items: [{ id: "a", type: "sightseeing", place: { name: "出雲大社", provider: "manual" } }] } as TripPlan;

// Record makes a newly added Domain provider require its own round-trip case.
const places = {
  manual: { name: "海辺の散策", provider: "manual" },
  mapbox: { name: "観光地点", provider: "mapbox", placeId: "test-mapbox-place", coordinate: [132.68, 35.40] },
  wikipedia: { name: "出雲大社", provider: "wikipedia", placeId: "test-wikipedia-place", coordinate: [132.69, 35.40] },
} satisfies Record<SightseeingPlanItem["place"]["provider"], SightseeingPlanItem["place"]>;

it.each(Object.values(places))("round-trips a complete plan with $provider sightseeing", (place) => {
  const storage = memoryStorage();
  const complete: TripPlan = {
    ...plan,
    updatedAt: "2026-09-12T00:00:00Z",
    conditions: { adults: 2, children: 1, considerations: ["ゆっくり歩く"] },
    items: [
      { id: "outbound", type: "movement", mode: "rail", route: {
        originStation: "京都", destinationStation: "出雲市", serviceDate: "2026-09-13",
        journeys: [{ departureTimeMinutes: 540, arrivalTimeMinutes: 600, transferCount: 0, legs: [{
          serviceUid: "test-service", trainNumber: "test-train", serviceType: "普通", trainName: "",
          originStation: "京都", destinationStation: "出雲市", departureTimeMinutes: 540, arrivalTimeMinutes: 600,
        }] }],
      } },
      { id: "visit", type: "sightseeing", place, date: "2026-09-13" },
      { id: "stay", type: "stay", destination: "出雲", checkInDate: "2026-09-13", checkOutDate: "2026-09-14",
        accommodation: { name: "テスト宿", checkInDate: "2026-09-13", checkOutDate: "2026-09-14",
          availability: "unknown", price: { amount: 12000, currency: "JPY", basis: "selected-dates" } },
        options: [],
      },
      { id: "walk", type: "movement", mode: "walk", origin: "宿", destination: "駅", date: "2026-09-14", note: "徒歩" },
    ],
  };
  saveTripPlan(storage, "session", complete);
  const serialized = storage.getItem(tripPlanStoreStorageKey);
  const reloadedStorage = memoryStorage({ [tripPlanStoreStorageKey]: serialized! });
  expect(loadTripPlan(reloadedStorage, "session")).toEqual(complete);
  expect(reloadedStorage.getItem(tripPlanStoreStorageKey)).toBe(serialized);
  saveTripPlan(reloadedStorage, "other-session", plan);
  expect(loadTripPlan(reloadedStorage, "session")).toEqual(complete);
});

it.each(["unknown", "Wikipedia", "", null, 1, {}, undefined])("rejects invalid provider %j without rewriting storage", (provider) => {
  const raw = JSON.stringify({ version: 2, plansBySessionId: { session: {
    ...plan, items: [{ id: "visit", type: "sightseeing", place: { name: "場所", provider } }],
  } } });
  const storage = memoryStorage({ [tripPlanStoreStorageKey]: raw });
  expect(loadTripPlan(storage, "session")).toBeUndefined();
  expect(storage.getItem(tripPlanStoreStorageKey)).toBe(raw);
});

it("restores wikipedia from the existing legacy single-plan format", () => {
  const legacy: TripPlan = { ...plan, items: [{ id: "visit", type: "sightseeing", place: places.wikipedia }] };
  const storage = memoryStorage({ [tripPlanStorageKey]: JSON.stringify(legacy) });
  expect(migrateLegacyTripPlan(storage, "session")).toEqual(legacy);
  expect(loadTripPlan(storage, "session")).toEqual(legacy);
});

it("preserves a provisional regional origin without converting it to a home location", () => {
  const storage = memoryStorage();
  const draft: TripPlan = { ...plan, items: [{ id: "movement", type: "movement", mode: "rail", route: {
    originStation: "神戸", originIsProvisional: true, destinationStation: "大阪", journeys: [],
  } }] };
  saveTripPlan(storage, "session", draft);
  expect(loadTripPlan(storage, "session")?.items).toEqual(draft.items);
});

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
  expect(storage.getItem(tripPlanStorageKey)).toBe(JSON.stringify(plan));
  expect(migrateLegacyTripPlan(storage, "another-session")).toBeUndefined();
});
