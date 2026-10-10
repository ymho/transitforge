import { expect, it } from "vitest";
import { applyTripProposal, createTrip, unmarkedBookingItems, validateTrip, type TripPatch } from "./trip";
import { officialGuideSnapshot } from "./official-guide";
import { selectedTripItemSnapshot } from "../../agent/runtime/agent-context-snapshot";
const item = { id: "stay", type: "stay" as const, title: "ホテル", selection: { status: "unselected" as const }, schedule: { type: "day" as const, date: "2026-10-12", timeZone: "Asia/Tokyo" } };
const trip = () => createTrip("11111111-1111-4111-8111-111111111111", "旅", "2026-10-10T00:00:00Z", [item]);
it("persists user marks separately from selection and removes them explicitly", () => {
 const original = trip();
 const apply = (patches: TripPatch[]) => applyTripProposal(original, { tripId: original.id, baseRevision: 0, summary: "予約", patches });
 const marked = apply([{ type: "item_booking", itemId: item.id, status: "booked" }]); validateTrip(marked);
 expect(marked.items[0]!.bookingStatus).toBe("booked"); expect(unmarkedBookingItems(marked)).toEqual([]);
 expect(unmarkedBookingItems(original)).toHaveLength(1);
 expect(unmarkedBookingItems(original, [{ itineraryItemId: item.id, status: "booked" }])).toEqual([]);
 expect(() => apply([{ type: "item_booking", itemId: "missing", status: "booked" }])).toThrow();
 expect(() => validateTrip({ ...original, items: [{ ...item, bookingStatus: "invalid" as "booked" }] })).toThrow();
 const cleared = applyTripProposal(marked, { tripId: marked.id, baseRevision: 0, summary: "解除", patches: [{ type: "item_booking", itemId: item.id }] });
 expect(cleared.items[0]!.bookingStatus).toBeUndefined();
 expect(selectedTripItemSnapshot(marked.items[0]!).bookingSemantics).toBe("user-mark-not-provider-verified");
 expect(officialGuideSnapshot(marked).items[0]!.bookingStatus).toBeUndefined();
});
it("keeps a mark on title changes but removes it on date/target changes and does not invalidate adoption", () => {
 const marked = { ...trip(), adoption: { confirmedAt: "2026-10-10T00:00:00Z" }, items: [{ ...item, bookingStatus: "booked" as const }] };
 const apply = (patches: TripPatch[]) => applyTripProposal(marked, { tripId: marked.id, baseRevision: 0, summary: "変更", patches });
 expect(apply([{ type: "replace", itemId: item.id, item: { ...marked.items[0]!, title: "宿" } }]).items[0]!.bookingStatus).toBe("booked");
 expect(apply([{ type: "item_memo", itemId: item.id, memo: "集合場所" }]).items[0]!.bookingStatus).toBe("booked");
 expect(apply([{ type: "replace", itemId: item.id, item: { ...marked.items[0]!, memo: "集合場所" } }]).items[0]!.bookingStatus).toBe("booked");
 expect(apply([{ type: "replace", itemId: item.id, item: { ...marked.items[0]!, schedule: { ...item.schedule, date: "2026-10-13" } } }]).items[0]!.bookingStatus).toBeUndefined();
 expect(apply([{ type: "item_booking", itemId: item.id, status: "not-required" }]).adoption?.needsReconfirmation).toBeUndefined();
});
it("clears marks when relative calendar bindings change and exempts reservation-free modes", () => {
 const relative = createTrip(trip().id, "旅", trip().createdAt, [{ ...item, bookingStatus: "booked", schedule: { type: "relative", dayId: "one" } }],
  { constraints: [], assumptions: [] }, "itinerary_draft", undefined, { version: 1, logicalDays: [{ id: "one" }], calendarBindings: [{ logicalDayId: "one", date: "2026-10-12", timeZone: "Asia/Tokyo", basis: "explicit" }] });
 const changed = applyTripProposal(relative, { tripId: relative.id, baseRevision: 0, summary: "日程", patches: [{ type: "timeline",
  timeline: { ...relative.timeline!, calendarBindings: [{ logicalDayId: "one", date: "2026-10-13", timeZone: "Asia/Tokyo", basis: "explicit" }] } }] });
 expect(changed.items[0]!.bookingStatus).toBeUndefined();
 const walking = createTrip(trip().id, "散歩", trip().createdAt, [{ id: "walk", title: "徒歩", type: "transport", detail: { status: "unresolved", mode: "walk" }, schedule: item.schedule }]);
 expect(unmarkedBookingItems(walking)).toEqual([]);
});
