import { describe, expect, it } from "vitest";
import { validateItinerarySchedule, validateZonedInstant, railScheduledInstant, projectStaySchedule, type ItinerarySchedule } from "./itinerary-schedule";

const tokyo = (time: string) => ({ at: `2026-09-22T${time}:00+09:00`, timeZone: "Asia/Tokyo" });
describe("ItinerarySchedule", () => {
  it.each<ItinerarySchedule>([
    { type: "fixed", startAt: tokyo("16:00"), endAt: tokyo("17:30") },
    { type: "fixed", startAt: tokyo("16:00") },
    { type: "fixed", startAt: tokyo("16:00"), endAt: tokyo("16:00") },
    { type: "window", earliestStart: tokyo("14:00"), latestEnd: tokyo("18:00"), durationMinutes: 90 },
    { type: "window", earliestStart: tokyo("14:00"), latestEnd: tokyo("14:00"), durationMinutes: 0 },
    { type: "window", earliestStart: tokyo("14:00"), latestEnd: tokyo("18:00") },
    { type: "day", date: "2020-09-22" }, { type: "day", date: "2028-02-29" },
    { type: "day", date: "2026-09-22", endDate: "2026-09-25", timeZone: "Europe/Vienna" },
    { type: "unscheduled" },
  ])("accepts and preserves precision without invented defaults: %j", (schedule) => {
    const before = structuredClone(schedule);
    expect(() => validateItinerarySchedule(schedule)).not.toThrow();
    expect(schedule).toEqual(before);
  });
  it.each([
    { type: "fixed", startAt: tokyo("17:30"), endAt: tokyo("16:00") },
    ...[-1, 1.5, NaN, Infinity, 241].map((durationMinutes) => ({ type: "window", earliestStart: tokyo("14:00"), latestEnd: tokyo("18:00"), durationMinutes })),
    { type: "window", earliestStart: tokyo("18:00"), latestEnd: tokyo("14:00") },
    ...["2026-02-30", "2026-02-29", "2026-13-01", "9/22", "", undefined].map((date) => ({ type: "day", date })),
    ...["2026-09-22", "2026-09-21", "2026-02-30"].map((endDate) => ({ type: "day", date: "2026-09-22", endDate })),
    { type: "day", date: "2026-09-22", timeZone: "unknown" },
    { type: "unscheduled", date: "2026-09-22" },
    { type: "day", date: "2026-09-22", raw: {} },
    { type: "fixed", startAt: { ...tokyo("16:00"), delayMinutes: 10 } },
    { type: "fixed" }, { type: "unknown" }, null,
  ])("rejects invalid/extra fields: %j", (schedule) => {
    expect(() => validateItinerarySchedule(schedule as ItinerarySchedule)).toThrow();
  });
  it.each([
    { at: "2026-09-22T16:00:00+09:00", timeZone: "Asia/Tokyo" },
    { at: "2026-09-22T16:00:00+02:00", timeZone: "Europe/Vienna" },
    { at: "2026-01-22T16:00:00+01:00", timeZone: "Europe/Vienna" },
    // The repeated wall-clock hour is explicitly disambiguated by the supplied offset.
    { at: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Vienna" },
    { at: "2026-10-25T02:30:00+01:00", timeZone: "Europe/Vienna" },
    { at: "2026-09-22T16:00:00Z", timeZone: "UTC" },
  ])("validates local instant against IANA rules: %j", (instant) => {
    expect(() => validateZonedInstant(instant)).not.toThrow();
  });
  it.each([
    { at: "2026-09-22T16:00:00+01:00", timeZone: "Europe/Vienna" },
    { at: "2026-09-22T16:00:00Z", timeZone: "Asia/Tokyo" },
    { at: "2026-03-29T02:30:00+01:00", timeZone: "Europe/Vienna" },
    { at: "2026-03-29T02:30:00+02:00", timeZone: "Europe/Vienna" },
    { at: "2026-10-25T02:30:00", timeZone: "Europe/Vienna" },
    { at: "2026-09-22T16:00:00+09:00", timeZone: "Unknown/Place" },
    { at: "2026-09-22T16:00:00+09:00", timeZone: "+09:00" },
    { at: "2026-09-22T16:00:00+09:00", timeZone: undefined },
    { at: "2026-09-22T16:00:00-00:00", timeZone: "UTC" },
  ])("rejects ambiguous, nonexistent or mismatched instant: %j", (instant) => {
    expect(() => validateZonedInstant(instant as Parameters<typeof validateZonedInstant>[0])).toThrow();
  });
  it("measures DST window width in elapsed minutes, not wall-clock subtraction", () => {
    const schedule: ItinerarySchedule = { type: "window",
      earliestStart: { at: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Vienna" },
      latestEnd: { at: "2026-10-25T02:30:00+01:00", timeZone: "Europe/Vienna" }, durationMinutes: 60 };
    expect(() => validateItinerarySchedule(schedule)).not.toThrow();
    expect(() => validateItinerarySchedule({ ...schedule, durationMinutes: 61 })).toThrow();
  });
  it.each([
    ["2026-09-21", 1460, "2026-09-22T00:20:00.000+09:00"],
    ["2026-09-21", 1679, "2026-09-22T03:59:00.000+09:00"],
    ["2026-09-22", 240, "2026-09-22T04:00:00.000+09:00"],
    ["2026-12-31", 1460, "2027-01-01T00:20:00.000+09:00"],
  ])("preserves service-day date rollover: %s + %i", (date, minutes, expected) => {
    expect(railScheduledInstant(date, minutes)).toEqual({ at: expected, timeZone: "Asia/Tokyo" });
  });
  it("projects stay dates exclusively and never guesses an unknown place zone", () => {
    expect(projectStaySchedule("2026-09-22", "2026-09-24")).toEqual({ type: "day", date: "2026-09-22", endDate: "2026-09-24" });
    expect(projectStaySchedule("2026-09-22", "2026-09-24", "Europe/Vienna")).toMatchObject({ timeZone: "Europe/Vienna" });
    expect(() => projectStaySchedule("2026-09-22", "2026-09-22")).toThrow();
  });
});
