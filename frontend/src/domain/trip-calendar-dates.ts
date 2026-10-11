import type { Trip } from "@raiquora/trip/trip";
import { localDate } from "@raiquora/trip/daily-itinerary";
import { effectiveTripConstraints } from "@raiquora/trip/trip-request";

/** Calendar navigation labels only. Never binds or upgrades a saved schedule/timezone. */
export function tripCalendarDates(trip: Trip): ReadonlyMap<string, string> {
  const days = trip.timeline?.logicalDays ?? [];
  const explicit = new Map(trip.timeline?.calendarBindings.map(binding => [binding.logicalDayId, binding.date]));
  if (!days.length) return explicit;
  const anchors: { index: number; date: string }[] = [];
  const ends: string[] = [];
  const datedDays = new Set<string>();
  for (const item of trip.items) {
    if (!item.logicalDayId) continue;
    const s = item.schedule;
    const date = s.type === "day" ? s.date : s.type === "fixed" ? localDate(s.startAt) : undefined;
    if (date) {
      anchors.push({ index: days.findIndex(day => day.id === item.logicalDayId), date });
      datedDays.add(item.logicalDayId);
    }
  }
  for (const c of effectiveTripConstraints(trip.request)) {
    const r = c.requirement;
    if (c.source === "user" && c.scope.type === "trip" && !c.scope.participantIds?.length && r.type === "dates" && r.start.earliest === r.start.latest) {
      anchors.push({ index: 0, date: r.start.earliest });
      // The trip may outlast the currently drafted days. Its end is a range
      // boundary, never evidence that the last existing logical day is that date.
      if (r.end && r.end.earliest === r.end.latest) ends.push(r.end.earliest);
    }
  }
  const starts = new Set(anchors.filter(anchor => anchor.index >= 0).map(anchor => shift(anchor.date, -anchor.index)));
  if (starts.size !== 1) return explicit;
  const start = [...starts][0]!;
  if ([...explicit].some(([id, date]) => shift(start, days.findIndex(day => day.id === id)) !== date)) return explicit;
  return new Map(days.flatMap((day, index) => {
    const date = shift(start, index);
    return explicit.has(day.id) || datedDays.has(day.id) || ends.every(end => date <= end) ? [[day.id, date] as const] : [];
  }));
}

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
