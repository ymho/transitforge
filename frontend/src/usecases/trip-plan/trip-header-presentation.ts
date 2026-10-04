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
  const dates = effectiveTripConstraints(trip.request).filter(c => c.scope.type === "trip").map(c => c.requirement).find(r => r.type === "dates");
  const start = dates?.type === "dates" && dates.start.earliest === dates.start.latest ? dates.start.earliest : bounds[0];
  const end = dates?.type === "dates" && dates.end && dates.end.earliest === dates.end.latest ? dates.end.latest : bounds.at(-1);
  if (!start) return "日程未定";
  if (!end) return `${Number(start.slice(5, 7))}月${Number(start.slice(8, 10))}日ー終了日未定`;
  if (end < start) return "日程要確認";
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  const crossYear = start.slice(0, 4) !== end.slice(0, 4);
  const label = (date: string) => `${crossYear ? `${Number(date.slice(0, 4))}年` : ""}${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  return days === 0 ? `${label(start)}・日帰り` : `${label(start)}ー${label(end)}・${days}泊${days + 1}日`;
}
