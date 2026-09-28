import { describe, expect, it } from "vitest";
import { applyTripProposal, createTrip } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import { proposeDayActivity } from "./propose-day-activity";

const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-09-12T08:00:00Z";
const activity = (name: string, dayId: string) => ({ id: name, title: name, type: "activity" as const,
  category: "sightseeing" as const, schedule: { type: "relative" as const, dayId } });
const trip = () => createTrip(id, "旅", at, [activity("first", "day-1"), activity("second", "day-2")],
  { constraints: [], assumptions: [] }, "itinerary_draft", undefined,
  { version: 1, logicalDays: [{ id: "day-1", label: "1日目" }, { id: "day-2", label: "2日目" }], calendarBindings: [] });

describe("manual day activity proposal", () => {
  it("places lunch on the chosen logical day without fabricating a date, time, place or booking", () => {
    const current = trip(), day = projectDailyItinerary(current).days[1]!;
    const proposal = proposeDayActivity(current, { itemId: "lunch", title: "昼食", category: "food", dayKey: day.dayKey });
    const saved = applyTripProposal(current, proposal);
    expect(saved.items.map(({ id }) => id)).toEqual(["first", "second", "lunch"]);
    expect(saved.items[2]).toEqual({ id: "lunch", title: "昼食", type: "activity", category: "food",
      schedule: { type: "relative", dayId: "day-2" } });
    expect(current.items).toHaveLength(2);
  });
  it("rejects a stale day or a focused item on another day", () => {
    const current = trip(), day = projectDailyItinerary(current).days[1]!;
    expect(() => proposeDayActivity(current, { itemId: "lunch", title: "昼食", category: "food", dayKey: "logical:missing" })).toThrow();
    expect(() => proposeDayActivity(current, { itemId: "lunch", title: "昼食", category: "food", dayKey: day.dayKey, afterId: "first" })).toThrow();
  });
  it("preserves a known calendar date without inventing a time zone", () => {
    const current = createTrip(id, "旅", at, [{ id: "visit", title: "参拝", type: "activity", category: "sightseeing",
      schedule: { type: "day", date: "2026-10-01" } }]);
    const day = projectDailyItinerary(current).days[0]!;
    const proposal = proposeDayActivity(current, { itemId: "event", title: "催し", category: "event", dayKey: day.dayKey });
    expect(applyTripProposal(current, proposal).items[1]!.schedule).toEqual({ type: "day", date: "2026-10-01" });
  });
  it("keeps a user-authored restaurant name as an unverified manual place without copying provider data", () => {
    const current = trip(), day = projectDailyItinerary(current).days[1]!;
    const proposal = proposeDayActivity(current, { itemId: "meal", title: "昼食", category: "food", dayKey: day.dayKey,
      afterId: "second", placeName: "  出雲そばの店  " });
    const item = applyTripProposal(current, proposal).items[2];
    expect(item).toMatchObject({ type: "activity", category: "food", schedule: { type: "relative", dayId: "day-2" },
      place: { name: "出雲そばの店", sources: [] } });
    expect(item).not.toHaveProperty("place.coordinate");
    expect(item).not.toHaveProperty("place.ref.providerPlaceId");
    expect(current.items).toHaveLength(2);
    expect(() => proposeDayActivity(current, { itemId: "meal", title: "昼食", category: "food", dayKey: day.dayKey, placeName: " " })).toThrow();
  });
});
