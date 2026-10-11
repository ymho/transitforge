import { expect, it } from "vitest";
import { createTrip, type Trip } from "@raiquora/trip/trip";
import { placesAt, placesTripId } from "../../../modules/trip/domain/trip-places.fixture";
import { tripCalendarDates } from "./trip-calendar-dates";

const trip = (): Trip => ({ ...createTrip(placesTripId, "旅", placesAt), schemaVersion: 3,
  timeline: { version: 1, logicalDays: [{ id: "d1" }, { id: "d2" }, { id: "d3" }], calendarBindings: [] } });
it.each(["hard", "soft"] as const)("uses an exact saved user start (%s) across month/year boundaries without editing schedules", strength => {
  const base = trip();
  const current: Trip = { ...base, request: { ...base.request, constraints: [{ id: "date", scope: { type: "trip" }, strength, source: "user",
    requirement: { type: "dates", start: { earliest: "2026-12-31", latest: "2026-12-31" } } }] } };
  const before = structuredClone(current);
  expect([...tripCalendarDates(current).values()]).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"]);
  expect(current).toEqual(before);
});
it("aligns a concrete item with its original logical day, and refuses conflicting anchors", () => {
  const base = trip();
  const current: Trip = { ...base, items: [{ id: "hotel", title: "宿", type: "stay", selection: { status: "unselected" }, logicalDayId: "d2",
    schedule: { type: "day", date: "2026-10-24", endDate: "2026-10-25" } }] };
  expect([...tripCalendarDates(current).values()]).toEqual(["2026-10-23", "2026-10-24", "2026-10-25"]);
  const conflict: Trip = { ...current, timeline: { ...current.timeline!, calendarBindings: [{ logicalDayId: "d1", date: "2026-10-20", timeZone: "Asia/Tokyo", basis: "explicit" }] } };
  expect([...tripCalendarDates(conflict)]).toEqual([["d1", "2026-10-20"]]);
});
it("does not guess from a flexible date, unrelated dated item, or a lone explicit binding", () => {
  const base = trip();
  expect([...tripCalendarDates({ ...base, items: [{ id: "hotel", title: "宿", type: "stay", selection: { status: "unselected" }, schedule: { type: "day", date: "2026-10-24" } }] })]).toEqual([]);
  expect([...tripCalendarDates({ ...base, request: { ...base.request, constraints: [{ id: "date", scope: { type: "trip" }, strength: "hard", source: "user",
    requirement: { type: "dates", start: { earliest: "2026-10-24", latest: "2026-10-25" } } }] } })]).toEqual([]);
  expect([...tripCalendarDates({ ...base, timeline: { ...base.timeline!, calendarBindings: [{ logicalDayId: "d1", date: "2026-10-24", timeZone: "Asia/Tokyo", basis: "explicit" }] } })]).toEqual([["d1", "2026-10-24"]]);
});
