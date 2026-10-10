import { createTrip, validateTrip, type Trip, type ItineraryItem } from "./trip";
import { validDate } from "./snapshot-validation";
export interface OfficialGuide { id: string; version: number; publishedAt: string; trip: Trip }
export function validateOfficialGuide(value: unknown): asserts value is OfficialGuide {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid official guide");
  const guide = value as OfficialGuide;
  validateTrip(guide.trip);
  if (Object.keys(guide).some(k => !["id", "version", "publishedAt", "trip"].includes(k)) || guide.id !== guide.trip.id ||
    !Number.isSafeInteger(guide.version) || guide.version < 1 || typeof guide.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(guide.publishedAt)) || new Date(guide.publishedAt).toISOString() !== guide.publishedAt) throw new Error("Invalid official guide");
}
/** Public snapshots never carry bookings, provider selections, exact dates, party or conversation state. */
export function officialGuideSnapshot(source: Trip): Trip {
  validateTrip(source);
  const dayIds = source.timeline?.logicalDays.map(d => d.id) ?? [];
  const dates = new Map<string, string>();
  const day = (item: ItineraryItem): string => {
    if (item.schedule.type === "relative") return item.schedule.dayId;
    if (item.logicalDayId) return item.logicalDayId;
    const s = item.schedule;
    const key = s.type === "day" ? s.date : s.type === "fixed" ? new Intl.DateTimeFormat("en-CA", { timeZone: s.startAt.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.startAt.at)) : s.type === "window" ? new Intl.DateTimeFormat("en-CA", { timeZone: s.earliestStart.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.earliestStart.at)) : "未定";
    const binding = source.timeline?.calendarBindings.find(b => b.date === key);
    if (binding) return binding.logicalDayId;
    if (!dates.has(key)) { let n = dayIds.length + 1; while (dayIds.includes(`guide-day-${n}`)) n++; const id = `guide-day-${n}`; dates.set(key, id); dayIds.push(id); }
    return dates.get(key)!;
  };
  const items: ItineraryItem[] = source.items.map(item => {
    const dayId = day(item), schedule = { type: "relative" as const, dayId };
    if (item.type === "activity") return { id: item.id, title: item.title, type: "activity", category: item.category,
      ...(item.place ? { place: { name: item.place.name, sources: [] } } : {}), logicalDayId: dayId, schedule };
    if (item.type === "stay") return { id: item.id, title: "宿泊先を選ぶ", type: "stay", selection: { status: "unselected" }, logicalDayId: dayId, schedule };
    return { id: item.id, title: "移動を検索する", type: "activity", category: "other", logicalDayId: dayId, schedule };
  });
  return createTrip(source.id, source.title, source.createdAt, items, { constraints: [], assumptions: [] }, "itinerary_draft", source.summaryDestination,
    { version: 1, logicalDays: [...new Set(dayIds)].map((id, i) => ({ id, label: `${i + 1}日目` })), calendarBindings: [] });
}
export function importOfficialGuide(guide: OfficialGuide, id: string, now: string, start: string, adults: number, children: number): Trip {
  if (!validDate(start) || !Number.isInteger(adults) || adults < 1 || adults > 50 || !Number.isInteger(children) || children < 0 || children > 20) throw new Error("日付・人数を確認してください");
  const source = officialGuideSnapshot(guide.trip);
  const timeline = { ...source.timeline!, calendarBindings: source.timeline!.logicalDays.map((d, i) => ({ logicalDayId: d.id,
    date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10), timeZone: "Asia/Tokyo", basis: "explicit" as const })) };
  const end = timeline.calendarBindings.at(-1)?.date ?? start;
  const trip = createTrip(id, source.title, now, source.items, { constraints: [{ id: "guide-dates", source: "user", strength: "hard", scope: { type: "trip" },
    requirement: { type: "dates", start: { earliest: start, latest: start }, end: { earliest: end, latest: end } } }], assumptions: [],
    party: { source: "user", adults, children: Array.from({ length: children }, () => ({})) } }, "itinerary_draft", source.summaryDestination, timeline);
  return { ...trip, officialOrigin: { guideId: guide.id, version: guide.version } };
}
