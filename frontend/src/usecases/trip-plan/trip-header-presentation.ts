import type { Trip } from "@raiquora/trip/trip";
import { effectiveTripConstraints } from "@raiquora/trip/trip-request";
import { bindRelativeSchedule } from "@raiquora/trip/itinerary-schedule";
import { localDate } from "@raiquora/trip/daily-itinerary";

export function tripDateLabel(trip: Trip): string {
  const bounds = trip.items.flatMap(({ schedule: s }) => {
    if (s.type === "day") return [s.date, s.endDate ?? s.date];
    if (s.type === "fixed") return [localDate(s.startAt), localDate(s.endAt ?? s.startAt)];
    if (s.type === "window") return [localDate(s.earliestStart), localDate(s.latestEnd)];
    if (s.type === "relative" && trip.timeline) { const b = bindRelativeSchedule(s, trip.timeline); return b ? [b.date, b.endDate ?? b.date] : []; }
    return [];
  }).sort();
  const dates = effectiveTripConstraints(trip.request).map(c => c.requirement).find(r => r.type === "dates");
  const exact = dates?.type === "dates" && dates.start.earliest === dates.start.latest && dates.end?.earliest === dates.end?.latest;
  const start = exact ? dates.start.earliest : bounds[0];
  const end = exact ? dates.end?.latest ?? dates.start.latest : bounds.at(-1);
  if (!start || !end) return "日程未定";
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  const crossYear = start.slice(0, 4) !== end.slice(0, 4);
  const label = (date: string) => `${crossYear ? `${Number(date.slice(0, 4))}年` : ""}${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  return days === 0 ? `${label(start)}・日帰り` : `${label(start)}ー${label(end)}・${days}泊${days + 1}日`;
}
