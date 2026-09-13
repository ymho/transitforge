import type { ItinerarySchedule } from "./itinerary-schedule";

interface Bounds { earliestStart: number; latestStart: number; earliestEnd: number; latestEnd: number }
function bounds(schedule: ItinerarySchedule): Bounds | undefined {
  if (schedule.type === "fixed" && schedule.endAt) return {
    earliestStart: Date.parse(schedule.startAt.at), latestStart: Date.parse(schedule.startAt.at),
    earliestEnd: Date.parse(schedule.endAt.at), latestEnd: Date.parse(schedule.endAt.at),
  };
  if (schedule.type === "window" && schedule.durationMinutes !== undefined) {
    const start = Date.parse(schedule.earliestStart.at), end = Date.parse(schedule.latestEnd.at), duration = schedule.durationMinutes * 60_000;
    return { earliestStart: start, latestStart: end - duration, earliestEnd: start + duration, latestEnd: end };
  }
  return undefined;
}
/** Ordered pair only, no scheduling optimizer or implicit placement at earliestStart.
 * possible is NOT proof of a chosen compatible placement (and remains overall unknown).
 */
export function orderedScheduleRelation(before: ItinerarySchedule, after: ItinerarySchedule, minimumMinutes = 0):
  "satisfied" | "violated" | "possible" | "unknown" {
  const a = bounds(before), b = bounds(after);
  if (!a || !b) return "unknown";
  const duration = minimumMinutes * 60_000;
  if (a.earliestEnd + duration > b.latestStart) return "violated";
  if (a.latestEnd + duration <= b.earliestStart) return "satisfied";
  return "possible";
}
