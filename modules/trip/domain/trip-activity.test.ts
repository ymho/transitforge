import { describe, it, expect } from "vitest";
import { createTrip, applyTripProposal, validateTrip, activityCategories, type ActivityItineraryItem, type TripPatch } from "./trip";

const activity = (id = "a"): ActivityItineraryItem => ({ id, type: "activity", title: "自由時間", category: "free-time", schedule: { type: "unscheduled" } });
const trip = () => createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-09-12T00:00:00Z", [activity()]);
describe("Activity in the single Trip aggregate", () => {
  it.each(activityCategories)("accepts %s and optional Place without inventing facts", (category) => {
    const result = { ...trip(), items: [{ ...activity(), category }] };
    expect(() => validateTrip(result)).not.toThrow();
    expect(result.items[0]).not.toHaveProperty("place");
    expect(() => validateTrip({ ...result, items: [{ ...result.items[0]!, place: { name: "広場", sources: [] } }] })).not.toThrow();
  });
  it.each([
    { category: "provider-genre" }, { raw: {} }, { price: 500 }, { image: "x" }, { title: " " }, { id: 4 }, { id: " " },
    { place: { name: "公園", sources: [], coordinate: { longitude: 181, latitude: 0 } } },
    { place: { name: "公園", sources: [], raw: {} } }, { schedule: undefined }, { schedule: { type: "day", date: "2026-02-30" } },
  ])("rejects invalid/extra activity fields %j", (invalid) => {
    expect(() => validateTrip({ ...trip(), items: [{ ...activity(), ...invalid } as ActivityItineraryItem] })).toThrow();
  });
  it("accepts window free time, day and fixed without changing their precision", () => {
    const start = { at: "2026-09-22T14:00:00+09:00", timeZone: "Asia/Tokyo" };
    const end = { at: "2026-09-22T16:00:00+09:00", timeZone: "Asia/Tokyo" };
    const items: ActivityItineraryItem[] = [
      { ...activity("window"), schedule: { type: "window", earliestStart: start, latestEnd: end, durationMinutes: 120 } },
      { ...activity("fixed"), schedule: { type: "fixed", startAt: start } },
      { ...activity("day"), schedule: { type: "day", date: "2026-09-22" } },
    ];
    expect(() => validateTrip({ ...trip(), items })).not.toThrow();
    expect(items.every((i) => i.place === undefined)).toBe(true);
  });
});
describe("V2 add atomic ordered semantics", () => {
  const apply = (patches: TripPatch[]) => applyTripProposal(trip(), { tripId: trip().id, summary: "変更", patches });
  it("appends or inserts after an existing ID; later add/replace can refer to earlier add", () => {
    const result = apply([{ type: "add", item: activity("b"), afterId: "a" }, { type: "add", item: activity("c"), afterId: "b" },
      { type: "replace", itemId: "b", item: { ...activity("b"), category: "food", title: "昼食" } }, { type: "add", item: activity("d") }]);
    expect(result.items.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.items[1]).toMatchObject({ title: "昼食", category: "food" });
    expect(result.revision).toBe(0); expect(result.updatedAt).toBe(trip().updatedAt);
  });
  it.each(["", "unknown", "b"])("rejects unknown/self/empty afterId %j atomically", (afterId) => {
    expect(() => apply([{ type: "add", item: activity("b"), afterId }])).toThrow();
  });
  it("rejects duplicate and invalid middle patches without returning or mutating partial state", () => {
    const original = trip(); const before = structuredClone(original);
    for (const invalid of [{ type: "add", item: activity() }, { type: "replace", itemId: "missing", item: activity("missing") }] as TripPatch[]) {
      expect(() => applyTripProposal(original, { tripId: original.id, summary: "invalid", patches: [
        { type: "add", item: activity("b") }, invalid, { type: "add", item: activity("c") },
      ] })).toThrow();
      expect(original).toEqual(before);
    }
  });
  it("valid generated sequences validate and are reference-independent", () => {
    for (let count = 0; count < 20; count++) {
      const patches: TripPatch[] = Array.from({ length: count }, (_, i) => ({ type: "add", item: activity(`new-${i}`), ...(i ? { afterId: `new-${i - 1}` } : {}) }));
      const result = apply(patches); expect(() => validateTrip(result)).not.toThrow();
      expect(result.items).toHaveLength(count + 1);
      if (patches[0]?.type === "add") expect(result.items[1]).not.toBe(patches[0].item);
    }
  });
});
