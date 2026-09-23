import type { ItinerarySchedule } from "./itinerary-schedule";
import { instantInZone } from "./weather-event-fact";

export type AreaTemporalRelation = "definite" | "possible" | "date-only" | "none" | "unknown";
/** An observation interval, not a fabricated item schedule. All intervals are half-open. */
export function areaScheduleOverlap(schedule: ItinerarySchedule, start: number, end: number): AreaTemporalRelation {
  switch (schedule.type) {
    case "unscheduled": return "unknown";
    case "day": {
      if (!schedule.timeZone) return "unknown";
      const first = instantInZone(start, schedule.timeZone).at.slice(0, 10), last = instantInZone(end - 1, schedule.timeZone).at.slice(0, 10);
      const excludedEnd = schedule.endDate ?? new Date(Date.parse(schedule.date) + 86400000).toISOString().slice(0, 10);
      return last < schedule.date || first >= excludedEnd ? "none" : "date-only";
    }
    case "fixed": {
      const a = Date.parse(schedule.startAt.at);
      if (!schedule.endAt) return "unknown";
      const b = Date.parse(schedule.endAt.at);
      return a === b ? a >= start && a < end ? "definite" : "none" : a < end && b > start ? "definite" : "none";
    }
    case "window": {
      const a = Date.parse(schedule.earliestStart.at), b = Date.parse(schedule.latestEnd.at);
      if (a >= end || b <= start) return "none";
      const duration = schedule.durationMinutes;
      if (duration === undefined) return "possible";
      // Every legal placement must intersect, not merely the earliest placement.
      return a + duration * 60000 > start && b - duration * 60000 < end ? "definite" : "possible";
    }
    case "relative": return "unknown";
  }
}
export function forecastCoversSchedule(schedule: ItinerarySchedule, hours: readonly number[]): boolean {
  if (schedule.type !== "fixed" && schedule.type !== "window") return false;
  const a = Date.parse(schedule.type === "fixed" ? schedule.startAt.at : schedule.earliestStart.at);
  const end = schedule.type === "fixed" ? schedule.endAt : schedule.latestEnd;
  if (!end) return false;
  const b = Date.parse(end.at);
  let covered = a;
  for (const hour of hours) {
    if (hour > covered) return false;
    if (hour + 3600000 > covered) covered = hour + 3600000;
    if (covered > a && covered >= b) return true;
  }
  return false;
}

/** Union of precipitation hours: every legal window placement vs at least one placement.
 * A window can be unavoidably exposed across adjacent hours even though no single hour is unavoidable.
 */
export function windowPrecipitationRelation(schedule: Extract<ItinerarySchedule, { type: "window" }>, hours: readonly number[]): "definite" | "possible" | "none" {
  const a = Date.parse(schedule.earliestStart.at), b = Date.parse(schedule.latestEnd.at);
  const intervals = hours.map((h) => [Math.max(a, h), Math.min(b, h + 3600000)] as const).filter(([s, e]) => s < e).sort(([x], [y]) => x - y);
  if (!intervals.length) return "none";
  let cursor = a, longestGap = 0;
  for (const [start, end] of intervals) { longestGap = Math.max(longestGap, start - cursor); cursor = Math.max(cursor, end); }
  longestGap = Math.max(longestGap, b - cursor);
  if (schedule.durationMinutes === undefined) return "possible";
  return longestGap < schedule.durationMinutes * 60000 ? "definite" : "possible";
}
