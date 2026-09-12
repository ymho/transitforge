import { describe, expect, it } from "vitest";
import { itineraryScheduleLabel } from "./itinerary-schedule-label";
import type { ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";

const at = (time: string) => ({ at: `2026-09-22T${time}:00+09:00`, timeZone: "Asia/Tokyo" });
describe("itinerary schedule labels", () => {
  it.each<[ItinerarySchedule, string]>([
    [{ type: "fixed", startAt: at("16:00"), endAt: at("17:30") }, "16:00〜17:30"],
    [{ type: "fixed", startAt: at("16:00") }, "16:00（終了時刻未定）"],
    [{ type: "window", earliestStart: at("14:00"), latestEnd: at("18:00"), durationMinutes: 90 }, "14:00〜18:00の間 / 約90分"],
    [{ type: "day", date: "2026-09-22" }, "9/22"],
    [{ type: "day", date: "2026-09-22", endDate: "2026-09-24" }, "9/22〜9/24（終了日を含まない）"],
    [{ type: "day", date: "2026-12-31", endDate: "2027-01-02" }, "2026/12/31〜2027/1/2（終了日を含まない）"],
    [{ type: "unscheduled" }, "時間未定"],
    [{ type: "fixed", startAt: at("23:30"), endAt: { at: "2026-09-23T00:20:00+09:00", timeZone: "Asia/Tokyo" } }, "9/22 23:30〜9/23 00:20"],
  ])("preserves schedule precision: %j", (schedule, expected) => {
    expect(itineraryScheduleLabel(schedule)).toBe(expected);
  });
  it("distinguishes zones and the repeated DST hour", () => {
    const label = itineraryScheduleLabel({ type: "window", durationMinutes: 60,
      earliestStart: { at: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Vienna" },
      latestEnd: { at: "2026-10-25T02:30:00+01:00", timeZone: "Europe/Vienna" } });
    expect(label).toContain("Europe/Vienna +02:00 → Europe/Vienna +01:00");
    expect(label).toContain("の間 / 約60分");
  });
});
