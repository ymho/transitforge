import { validateItinerarySchedule, type ItinerarySchedule, type ZonedInstant } from "@raiquora/trip/itinerary-schedule";

/** Shared response projection, independent of today's date, browser timezone, DOM and legacy UI. */
export function itineraryScheduleLabel(schedule: ItinerarySchedule, includeStartDate = false): string {
  validateItinerarySchedule(schedule);
  if (schedule.type === "unscheduled") return "時間未定";
  if (schedule.type === "day") {
    const showYear = schedule.endDate !== undefined && schedule.date.slice(0, 4) !== schedule.endDate.slice(0, 4);
    const date = dayLabel(schedule.date, showYear);
    return `${date}${schedule.endDate ? `〜${dayLabel(schedule.endDate, showYear)}（終了日を含まない）` : ""}${schedule.timeZone ? `（${schedule.timeZone}）` : ""}`;
  }
  if (schedule.type === "relative") {
    const part = schedule.part === "morning" ? "午前" : schedule.part === "afternoon" ? "午後" : schedule.part === "evening" ? "夕方" : schedule.part === "overnight" ? "夜間" : "時間帯未定";
    const duration = schedule.durationMinutes ? ` / ${schedule.durationMinutes.minimum}〜${schedule.durationMinutes.maximum}分` : "";
    return `${schedule.dayId}${schedule.endDayId ? `〜${schedule.endDayId}` : ""} ${part}${duration}`;
  }
  const start = schedule.type === "fixed" ? schedule.startAt : schedule.earliestStart;
  const end = schedule.type === "fixed" ? schedule.endAt : schedule.latestEnd;
  const showDates = includeStartDate || end !== undefined && start.at.slice(0, 10) !== end.at.slice(0, 10);
  const showYear = end !== undefined && start.at.slice(0, 4) !== end.at.slice(0, 4);
  const endpoint = (instant: ZonedInstant): string => `${showDates ? `${dayLabel(instant.at.slice(0, 10), showYear)} ` : ""}${instant.at.slice(11, 16)}`;
  const span = `${endpoint(start)}${end ? `〜${endpoint(end)}` : "（終了時刻未定）"}`;
  // Zone labels avoid misleading comparisons, including the repeated hour at a DST transition.
  const zone = start.timeZone !== "Asia/Tokyo" || (end && end.timeZone !== start.timeZone)
    ? `（${start.timeZone} ${offset(start)}${end && (end.timeZone !== start.timeZone || offset(end) !== offset(start)) ? ` → ${end.timeZone} ${offset(end)}` : ""}）` : "";
  return schedule.type === "window"
    ? `${span}の間${schedule.durationMinutes !== undefined ? ` / 約${schedule.durationMinutes}分` : ""}${zone}`
    : `${span}${zone}`;
}
function dayLabel(date: string, showYear = false): string { return `${showYear ? `${date.slice(0, 4)}/` : ""}${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`; }
function offset(instant: ZonedInstant): string { return instant.at.endsWith("Z") ? "UTC" : instant.at.slice(-6); }
