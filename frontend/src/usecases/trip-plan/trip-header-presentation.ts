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

/** Changed wishes never silently move an already selected train or hotel. */
export function tripDateMismatchNotice(trip: Trip): string | undefined {
  const dates = effectiveTripConstraints(trip.request).filter(c => c.scope.type === "trip" && !c.scope.participantIds?.length && c.source === "user")
    .map(c => c.requirement).filter(r => r.type === "dates");
  if (dates.length !== 1) return undefined;
  const desired = dates[0]!;
  if (desired.start.earliest !== desired.start.latest) return undefined;
  const start = desired.start.earliest, end = desired.end?.latest;
  const conflicts = trip.items.filter(item => {
    const s = item.schedule;
    const range = s.type === "day" ? [s.date, s.endDate ?? s.date] : s.type === "fixed" ? [localDate(s.startAt), localDate(s.endAt ?? s.startAt)] :
      s.type === "relative" && trip.timeline ? (() => { const b = bindRelativeSchedule(s, trip.timeline!); return b ? [b.date, b.endDate ?? b.date] : []; })() : [];
    return range.some(date => date < start || end !== undefined && date > end);
  });
  return conflicts.length ? `希望日程と保存済みの日時が異なる予定があります：${conflicts.map(item => item.title).join("、")}。列車・宿は元の日時を保持しています。相談から日程に合う候補を選び直してください。` : undefined;
}
