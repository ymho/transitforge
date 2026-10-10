import { expect, it } from "vitest";
import { projectDailyItinerary } from "./daily-itinerary";
import { createTrip, applyTripProposal, type ItineraryItem } from "./trip";
import { proposeTripItemChange } from "./trip-item-proposal";

const at = "2026-09-28T00:00:00Z";
const initial: ItineraryItem[] = [
  { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01" } },
  { id: "hotel", title: "宿泊", type: "stay", selection: { status: "unselected" }, schedule: { type: "day", date: "2026-10-02" } },
];
const trip = () => createTrip("00000000-0000-4000-8000-000000000756", "出雲", at, initial);

it("adds a named meal and unresolved movement without fabricating time or provider identity", () => {
  let current = trip(); const dayKey = projectDailyItinerary(current).days[0]!.dayKey;
  const meal = proposeTripItemChange(current, { action: "add-activity", itemId: "meal", title: "昼食", category: "food",
    placeName: "出雲そば", dayKey, afterId: "shrine" });
  expect(current.items).toHaveLength(2);
  current = applyTripProposal(current, meal);
  expect(current.items[1]).toMatchObject({ title: "昼食", place: { name: "出雲そば", sources: [] } });
  const movement = proposeTripItemChange(current, { action: "add-transport", itemId: "to-hotel", title: "宿へ移動", dayKey,
    afterId: "meal" });
  current = applyTripProposal(current, movement);
  expect(current.items[2]).toMatchObject({ type: "transport", detail: { status: "unresolved" }, schedule: { type: "day", date: "2026-10-01" } });
  expect(current.items.map(item => item.id)).toEqual(["shrine", "meal", "to-hotel", "hotel"]);
});

it("concretizes a manual non-rail leg while preserving its authored day and other items", () => {
  const current = createTrip(trip().id, "出雲", at, [{ id: "ride", title: "移動", type: "transport", detail: { status: "unresolved" },
    schedule: { type: "relative", dayId: "second" } }, ...initial], undefined, "itinerary_draft", undefined,
  { version: 1, logicalDays: [{ id: "second" }], calendarBindings: [] });
  const proposal = proposeTripItemChange(current, { action: "select-manual-transport", itemId: "ride", title: "バスで移動", mode: "bus",
    origin: "出雲大社", destination: "出雲駅" });
  const updated = applyTripProposal(current, proposal);
  expect(updated.items[0]).toMatchObject({ schedule: { type: "relative", dayId: "second" }, detail: { status: "selected", mode: "bus",
    provenance: { type: "manual" }, origin: { sources: [] }, destination: { sources: [] } } });
  expect(updated.items.slice(1)).toEqual(current.items.slice(1));
  expect(() => proposeTripItemChange(current, { action: "select-manual-transport", itemId: "ride", title: "列車", mode: "rail" as never,
    origin: "出雲", destination: "大阪" })).toThrow();
});

it("rejects stale day, unknown item, foreign insertion point and forged provider fields", () => {
  const current = trip(), dayKey = projectDailyItinerary(current).days[1]!.dayKey;
  expect(() => proposeTripItemChange(current, { action: "add-activity", itemId: "meal", title: "昼食", category: "food", dayKey, afterId: "shrine" })).toThrow();
  expect(() => proposeTripItemChange(current, { action: "add-stay", itemId: "new", title: "宿", dayKey: "date:stale" })).toThrow();
  expect(() => proposeTripItemChange(current, { action: "rename", itemId: "not-in-trip", title: "宿" })).toThrow();
  expect(() => proposeTripItemChange(current, { action: "add-activity", itemId: "meal", title: "昼食", category: "food", dayKey,
    placeName: "店", providerPlaceId: "forged" } as never)).toThrow();
  expect(() => proposeTripItemChange(current, { action: "set-manual-stay-place", itemId: "hotel", placeName: "出雲駅前" }).patches[0])
    .not.toThrow();
});
it("replaces a selected activity place only after an explicit manual edit and rechecks its confirmation", () => {
  const original = createTrip(trip().id, "出雲", at, [{ id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing",
    schedule: { type: "day", date: "2026-10-01" }, place: { name: "旧店", sources: [] },
    decision: { confirmedAt: at } }, initial[1]!]);
  const preview = proposeTripItemChange(original, { action: "set-manual-activity-place", itemId: "shrine", placeName: "新しい店" });
  expect(original.items[0]).toMatchObject({ place: { name: "旧店" }, decision: { confirmedAt: at } });
  expect(applyTripProposal(original, preview).items[0]).toMatchObject({ place: { name: "新しい店", sources: [] }, decision: { needsReconfirmation: true } });
});
it("moves an authored activity to an existing Trip day without guessing a clock time", () => {
  const original = trip(), dayKey = projectDailyItinerary(original).days[1]!.dayKey;
  const preview = proposeTripItemChange(original, { action: "change-day", itemId: "shrine", dayKey });
  expect(original.items[0]?.schedule).toEqual({ type: "day", date: "2026-10-01" });
  expect(applyTripProposal(original, preview).items[0]?.schedule).toEqual({ type: "day", date: "2026-10-02" });
  expect(() => proposeTripItemChange(original, { action: "change-day", itemId: "shrine", dayKey: "date:missing" })).toThrow();
});
it("retains a chosen candidate as a Trip memo with its cited retrieval time and clears the citation when its place changes", () => {
  const current = trip(), dayKey = projectDailyItinerary(current).days[0]!.dayKey;
  const proposal = proposeTripItemChange(current, { action: "add-researched-activity", itemId: "garden", dayKey,
    title: "青葉庭園", category: "sightseeing", sourceUrl: "https://example.org/garden", observedAt: "2026-09-26T10:00:00Z" });
  expect(current.items).toHaveLength(2);
  const adopted = applyTripProposal(current, proposal);
  expect(adopted.items[1]).toMatchObject({ id: "garden", place: { name: "青葉庭園", sources: [] },
    research: { sourceUrl: "https://example.org/garden", observedAt: "2026-09-26T10:00:00Z" } });
  const edit = proposeTripItemChange(adopted, { action: "set-manual-activity-place", itemId: "garden", placeName: "別の庭園" });
  expect(applyTripProposal(adopted, edit).items[1]).not.toHaveProperty("research");
  expect(() => proposeTripItemChange(current, { action: "add-researched-activity", itemId: "bad", dayKey,
    title: "庭園", category: "sightseeing", sourceUrl: "https://example.org/?api_key=secret", observedAt: "2026-09-26T10:00:00Z" })).toThrow();
  expect(() => proposeTripItemChange(current, { action: "add-researched-activity", itemId: "bad", dayKey,
    title: "庭園", category: "sightseeing", sourceUrl: "https://example.org/", observedAt: "2026-09-99T10:00:00Z" })).toThrow();
});

it("saves and clears multiline plain text without changing confirmed itinerary semantics", () => {
  const current = { ...trip(), adoption: { confirmedAt: at }, items: trip().items.map(item => ({ ...item, decision: { confirmedAt: at } })) };
  const text = "持ち物\n<script>alert(1)</script> **そのまま**";
  const updated = applyTripProposal(current, proposeTripItemChange(current, { action: "set-memo", itemId: "shrine", memo: text }));
  expect(updated.items[0]).toEqual({ ...current.items[0], memo: text });
  expect(updated.adoption).toEqual(current.adoption);
  expect(updated.items[1]).toEqual(current.items[1]);
  expect(applyTripProposal(updated, proposeTripItemChange(updated, { action: "set-memo", itemId: "shrine", memo: "  " })).items[0]).not.toHaveProperty("memo");
  expect(() => proposeTripItemChange(current, { action: "set-memo", itemId: "missing", memo: text })).toThrow();
  expect(() => proposeTripItemChange(current, { action: "set-memo", itemId: "shrine", memo: "a".repeat(4001) })).toThrow();
});
