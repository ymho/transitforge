import { expect, it } from "vitest";
import { createTrip, type ItineraryItem } from "./trip";
import { datedSearchSelectionTarget } from "./search-selection-target";

const slots: ItineraryItem[] = ["outbound", "return"].map((id, i) => ({ id, type: "transport", title: id,
  schedule: { type: "relative", dayId: `day-${i + 1}` }, detail: { status: "unresolved" } }));
const trip = createTrip("75800000-0000-4000-8000-000000000001", "旅", "2026-10-04T00:00:00Z", slots, { constraints: [{ id: "dates", scope: { type: "trip" }, strength: "hard", source: "user",
  requirement: { type: "dates", start: { earliest: "2026-10-05", latest: "2026-10-05" } } }], assumptions: [] }, "inspiration", undefined,
{ version: 1, logicalDays: [{ id: "day-1" }, { id: "day-2" }], calendarBindings: [] });
const item = (date: string, zone = "Asia/Tokyo"): ItineraryItem => ({ id: "verified", type: "transport", title: "検索結果",
  schedule: { type: "fixed", startAt: { at: `${date}T08:00:00+09:00`, timeZone: zone } }, detail: { status: "unresolved" } });

it("matches every alternative to the uniquely dated outbound slot without mutating the Trip", () => {
  const before = structuredClone(trip);
  expect(datedSearchSelectionTarget([item("2026-10-05"), item("2026-10-05")], slots, trip)?.id).toBe("outbound");
  expect(datedSearchSelectionTarget([item("2026-10-06")], slots, trip)?.id).toBe("return");
  expect(trip).toEqual(before);
});
it("keeps unknown and flexible trip dates ambiguous", () => {
  expect(datedSearchSelectionTarget([item("2026-10-05")], slots, { ...trip, request: { constraints: [], assumptions: [] } })).toBeUndefined();
  const flexible = { ...trip, request: { ...trip.request, constraints: trip.request.constraints.map(c => ({ ...c, requirement: { type: "dates" as const,
    start: { earliest: "2026-10-05", latest: "2026-10-06" } } })) } };
  expect(datedSearchSelectionTarget([item("2026-10-05")], slots, flexible)).toBeUndefined();
});
it("does not choose between two slots on the same day or alternatives on different days", () => {
  const sameDay = slots.map(slot => ({ ...slot, schedule: slots[0]!.schedule }));
  expect(datedSearchSelectionTarget([item("2026-10-05")], sameDay, trip)).toBeUndefined();
  expect(datedSearchSelectionTarget([item("2026-10-05"), item("2026-10-06")], slots, trip)).toBeUndefined();
});
it("honors persisted calendar bindings and refuses incomplete or conflicting zones", () => {
  const explicit = { ...trip, timeline: { ...trip.timeline!, calendarBindings: [
    { logicalDayId: "day-1", date: "2026-10-06", timeZone: "Asia/Tokyo", basis: "explicit" as const },
    { logicalDayId: "day-2", date: "2026-10-05", timeZone: "Asia/Tokyo", basis: "explicit" as const },
  ] } };
  expect(datedSearchSelectionTarget([item("2026-10-05")], slots, explicit)?.id).toBe("return");
  expect(datedSearchSelectionTarget([item("2026-10-05"), item("2026-10-05", "Europe/Vienna")], slots, trip)).toBeUndefined();
  const partial = { ...trip, timeline: { ...trip.timeline!, calendarBindings: [explicit.timeline.calendarBindings[0]!] } };
  expect(datedSearchSelectionTarget([item("2026-10-05")], slots, partial)).toBeUndefined();
});
