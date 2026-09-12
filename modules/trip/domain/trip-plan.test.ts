import { expect, it } from "vitest";

import {
  applyTripPlanPatches,
  tripPlanFromTravelPlan,
  tripPlanPatchesFromTravelPlan,
  validateTripPlanPatches,
  type TripPlan,
  type TripPlanPatch,
} from "./trip-plan";

it("rejects update proposals that lose item references or ordering", () => {
  expect(validateTripPlanPatches(plan, [{
    type: "move",
    itemId: "a",
    afterId: "missing",
  }])).toEqual({
    valid: false,
    reason: "移動先 missing が見つかりません",
  });
  expect(validateTripPlanPatches(plan, [{
    type: "remove",
    itemId: "missing",
  }]).valid).toBe(false);
});

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
  const patches = tripPlanPatchesFromTravelPlan(travel, plan);
  expect(patches.slice(1).map(({ type }) => type)).toEqual(["add", "add", "add"]);
  const next = applyTripPlanPatches(plan, patches);
  expect(next.items.some((item) => item.type === "sightseeing")).toBe(true);
  expect(next.items.find((item) => item.id === "outbound")).toMatchObject({ type: "movement" });
  expect(next.items.find((item) => item.id === "stay")).toMatchObject({
    type: "stay",
    checkInDate: "2026-09-01",
  });
});

it("rejects duplicate additions instead of skipping them or upserting a missing section", () => {
  expect(() => applyTripPlanPatches(plan, [
    {
      type: "add",
      item: { id: "a", type: "sightseeing", place: { name: "日御碕", provider: "manual" } },
    },
    {
      type: "replace",
      itemId: "missing",
      item: { id: "missing", type: "sightseeing", place: { name: "稲佐の浜", provider: "manual" } },
    },
  ])).toThrow("既に存在します");
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

it("creates a day trip without a stay card", () => {
  const travel = {
    destination: "宮島",
    dayTrip: true,
    checkInDate: "2026-08-28",
    checkOutDate: "2026-08-28",
    outbound: { originStation: "京都", destinationStation: "宮島口", journeys: [] },
    returning: { originStation: "宮島口", destinationStation: "京都", journeys: [] },
    accommodations: [],
  };
  const next = tripPlanFromTravelPlan(travel);
  expect(next.items.map(({ id }) => id)).toEqual(["outbound", "return"]);

  const overnight: TripPlan = {
    ...next,
    items: [
      next.items[0]!,
      {
        id: "stay", type: "stay", destination: "宮島",
        checkInDate: "2026-08-28", checkOutDate: "2026-08-29",
      },
      next.items[1]!,
    ],
  };
  const updated = applyTripPlanPatches(overnight, tripPlanPatchesFromTravelPlan(travel, overnight));
  expect(updated.items.some(({ type }) => type === "stay")).toBe(false);
  const repeated = tripPlanPatchesFromTravelPlan(travel, updated);
  expect(repeated.some(({ type }) => type === "remove")).toBe(false);
  expect(validateTripPlanPatches(updated, repeated).valid).toBe(true);
  expect(applyTripPlanPatches(updated, repeated).items).toEqual(updated.items);
});

const item = (id: string) => ({ id, type: "sightseeing" as const, place: { name: id, provider: "manual" as const } });
const invalidSequences: Array<{ name: string; patches: TripPlanPatch[] }> = [
  { name: "missing replace", patches: [{ type: "replace", itemId: "missing", item: item("replacement") }] },
  { name: "duplicate add", patches: [{ type: "add", item: item("a") }] },
  { name: "missing remove", patches: [{ type: "remove", itemId: "missing" }] },
  { name: "missing move", patches: [{ type: "move", itemId: "missing" }] },
  { name: "invalid add anchor", patches: [{ type: "add", item: item("b"), afterId: "missing" }] },
  { name: "invalid move anchor", patches: [{ type: "move", itemId: "a", afterId: "missing" }] },
  { name: "empty anchor", patches: [{ type: "move", itemId: "a", afterId: "" }] },
  { name: "self move", patches: [{ type: "move", itemId: "a", afterId: "a" }] },
  { name: "remove then replace", patches: [{ type: "remove", itemId: "a" }, { type: "replace", itemId: "a", item: item("a") }] },
  { name: "removed anchor", patches: [{ type: "remove", itemId: "a" }, { type: "add", item: item("b"), afterId: "a" }] },
  { name: "duplicate in sequence", patches: [{ type: "add", item: item("b") }, { type: "add", item: item("b") }] },
];

it.each(invalidSequences)("rejects $name atomically including earlier metadata", ({ patches }) => {
  const original = structuredClone(plan);
  const sequence: TripPlanPatch[] = [{ type: "metadata", title: "変更しない" }, ...patches, { type: "add", item: item("z") }];
  const before = structuredClone(sequence);
  const validation = validateTripPlanPatches(plan, sequence);
  expect(validation.valid).toBe(false);
  expect(() => applyTripPlanPatches(plan, sequence)).toThrow(validation.reason);
  expect(plan).toEqual(original);
  expect(sequence).toEqual(before);
});

it("applies a valid ordered sequence while preserving replacement identity and the original", () => {
  const original = structuredClone(plan);
  const patches: TripPlanPatch[] = [
    { type: "add", item: item("b"), afterId: "a" },
    { type: "replace", itemId: "b", item: item("temporary-id") },
    { type: "add", item: item("c"), afterId: "b" },
    { type: "move", itemId: "a", afterId: "c" },
    { type: "remove", itemId: "c" },
    { type: "add", item: item("c") },
    { type: "metadata", title: "新しい旅" },
  ];
  expect(validateTripPlanPatches(plan, patches).valid).toBe(true);
  const next = applyTripPlanPatches(plan, patches, new Date("2026-09-12T00:00:00Z"));
  expect(next.items).toEqual([{ ...item("temporary-id"), id: "b" }, plan.items[0], item("c")]);
  expect(next.title).toBe("新しい旅");
  expect(next.updatedAt).toBe("2026-09-12T00:00:00.000Z");
  expect(plan).toEqual(original);
});

it("keeps validation and application consistent across generated patch sequences", () => {
  const operations: TripPlanPatch[] = [
    { type: "add", item: item("a") }, { type: "add", item: item("b"), afterId: "a" },
    { type: "replace", itemId: "a", item: item("different-id") },
    { type: "replace", itemId: "b", item: item("a") },
    { type: "remove", itemId: "a" }, { type: "remove", itemId: "b" },
    { type: "move", itemId: "a", afterId: "b" }, { type: "move", itemId: "b" },
    { type: "add", item: item("c"), afterId: "" }, { type: "metadata", title: "更新" },
  ];
  const original = structuredClone(plan);
  let accepted = 0;
  let rejected = 0;
  for (const first of operations) for (const second of operations) for (const third of operations) {
    const patches = [first, second, third];
    const before = structuredClone(patches);
    if (validateTripPlanPatches(plan, patches).valid) {
      const next = applyTripPlanPatches(plan, patches);
      expect(new Set(next.items.map(({ id }) => id)).size).toBe(next.items.length);
      accepted++;
    } else {
      expect(() => applyTripPlanPatches(plan, patches)).toThrow();
      rejected++;
    }
    expect(plan).toEqual(original);
    expect(patches).toEqual(before);
  }
  expect(accepted).toBeGreaterThan(0);
  expect(rejected).toBeGreaterThan(0);
});

it("explicitly adds a stay when changing a day trip to an overnight plan", () => {
  const travel = { destination: "出雲", checkInDate: "2026-09-13", checkOutDate: "2026-09-14",
    outbound: { originStation: "京都", destinationStation: "出雲市", journeys: [] },
    returning: { originStation: "出雲市", destinationStation: "京都", journeys: [] }, accommodations: [],
  };
  const current = tripPlanFromTravelPlan({ ...travel, dayTrip: true });
  const patches = tripPlanPatchesFromTravelPlan(travel, current);
  expect(patches.map(({ type }) => type)).toEqual(["metadata", "replace", "add", "replace"]);
  expect(validateTripPlanPatches(current, patches).valid).toBe(true);
  expect(applyTripPlanPatches(current, patches).items.map(({ id }) => id)).toEqual(["outbound", "stay", "return"]);
});

it("rejects an ambiguous base plan with duplicate item IDs", () => {
  const ambiguous = { ...plan, items: [item("a"), item("a")] };
  expect(validateTripPlanPatches(ambiguous, []).valid).toBe(false);
  expect(() => applyTripPlanPatches(ambiguous, [])).toThrow("重複");
});
