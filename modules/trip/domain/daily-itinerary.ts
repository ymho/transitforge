import { bindRelativeSchedule, type LocalDate, type ZonedInstant } from "./itinerary-schedule";
import { validateTrip, type ItineraryItem, type Trip } from "./trip";

export type DayEntryRole = "start" | "continue" | "end" | "visit" | "possible-window";
export type DayEntryPlacement = "confirmed" | "date-only" | "possible" | "unbound";
export interface DayEntry {
  readonly entryKey: string;
  readonly sourceItemId: string;
  readonly sourceRevision: number;
  readonly role: DayEntryRole;
  readonly placement: DayEntryPlacement;
  readonly logicalDayId?: string;
  readonly localDate?: LocalDate;
  readonly timeZone?: string;
}
export interface DayView {
  readonly dayKey: string;
  readonly label: string;
  readonly logicalDayId?: string;
  readonly localDate?: LocalDate;
  readonly timeZone?: string;
  readonly entries: readonly DayEntry[];
  readonly overnightRefs: readonly string[];
  readonly coverage: { readonly complete: boolean; readonly omittedCount: number };
  readonly emptyReason?: "not-planned" | "explicit-free-time" | "not-retrieved";
}
export interface DailyItineraryProjection {
  readonly version: 1;
  readonly sourceTripId: string;
  readonly sourceRevision: number;
  readonly days: readonly DayView[];
  readonly unscheduled: readonly DayEntry[];
  readonly coverage: { readonly complete: boolean; readonly omittedCount: number; readonly unknownItemIds: readonly string[] };
  readonly continuation?: { readonly afterDayKey: string };
}
export interface DailyItineraryOptions {
  readonly range?: { readonly from?: LocalDate; readonly to?: LocalDate };
  readonly cursor?: { readonly afterDayKey: string };
  readonly limit?: number;
}

/** Deterministic read model only. Trip.items and timeline remain the sole editing authorities. */
export function projectDailyItinerary(trip: Trip, options: DailyItineraryOptions = {}): DailyItineraryProjection {
  validateTrip(trip);
  const buckets = new Map<string, MutableDay>();
  const unscheduled: DayEntry[] = [];
  const unknownItemIds = new Set<string>();
  seedTimelineDays(trip, buckets);
  trip.items.forEach((item, order) => projectItem(trip, item, order, buckets, unscheduled, unknownItemIds));
  let days = [...buckets.values()].sort((a, b) => a.order - b.order || a.dayKey.localeCompare(b.dayKey));
  if (options.range?.from) days = days.filter((d) => !d.localDate || d.localDate >= options.range!.from!);
  if (options.range?.to) days = days.filter((d) => !d.localDate || d.localDate <= options.range!.to!);
  if (options.cursor) {
    const cursor = days.findIndex(({ dayKey }) => dayKey === options.cursor!.afterDayKey);
    if (cursor < 0) throw new Error("Invalid itinerary cursor");
    days = days.slice(cursor + 1);
  }
  const limit = options.limit ?? 31;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 90) throw new Error("Invalid itinerary page limit");
  const omittedCount = Math.max(0, days.length - limit);
  const selected = days.slice(0, limit).map(finishDay);
  return structuredClone({ version: 1, sourceTripId: trip.id, sourceRevision: trip.revision, days: selected, unscheduled,
    coverage: { complete: omittedCount === 0, omittedCount, unknownItemIds: [...unknownItemIds] },
    ...(omittedCount ? { continuation: { afterDayKey: selected.at(-1)!.dayKey } } : {}) });
}

interface MutableDay {
  dayKey: string; label: string; order: number; logicalDayId?: string; localDate?: LocalDate; timeZone?: string;
  entries: DayEntry[]; overnightRefs: string[];
}
function seedTimelineDays(trip: Trip, buckets: Map<string, MutableDay>): void {
  trip.timeline?.logicalDays.forEach((logical, index) => {
    const binding = trip.timeline!.calendarBindings.find((b) => b.logicalDayId === logical.id);
    const dayKey = binding ? calendarDayKey(binding.date, binding.timeZone, logical.id) : `logical:${logical.id}`;
    buckets.set(dayKey, { dayKey, label: logical.label ?? (binding?.date ?? logical.id), order: index * 10_000,
      logicalDayId: logical.id, ...(binding ? { localDate: binding.date, timeZone: binding.timeZone } : {}), entries: [], overnightRefs: [] });
  });
}
function projectItem(trip: Trip, item: ItineraryItem, order: number, buckets: Map<string, MutableDay>, unscheduled: DayEntry[], unknown: Set<string>): void {
  const schedule = item.schedule;
  if (schedule.type === "unscheduled") {
    unscheduled.push(entry(trip, item, "visit", "unbound", "unscheduled")); unknown.add(item.id); return;
  }
  if (schedule.type === "relative") {
    const bound = trip.timeline ? bindRelativeSchedule(schedule, trip.timeline) : undefined;
    const key = bound ? calendarDayKey(bound.date, bound.timeZone, schedule.dayId) : `logical:${schedule.dayId}`;
    add(buckets, key, { label: bound?.date ?? schedule.dayId, order: dayOrder(trip, schedule.dayId, order), logicalDayId: schedule.dayId,
      ...(bound ? { localDate: bound.date, timeZone: bound.timeZone } : {}) }, entry(trip, item, "visit", bound ? "date-only" : "unbound", key, schedule.dayId, bound?.date, bound?.timeZone));
    if (!bound) unknown.add(item.id);
    if (schedule.endDayId && schedule.endDayId !== schedule.dayId) {
      const endBinding = trip.timeline?.calendarBindings.find((b) => b.logicalDayId === schedule.endDayId);
      const endKey = endBinding ? calendarDayKey(endBinding.date, endBinding.timeZone, schedule.endDayId) : `logical:${schedule.endDayId}`;
      add(buckets, endKey, { label: endBinding?.date ?? schedule.endDayId, order: dayOrder(trip, schedule.endDayId, order), logicalDayId: schedule.endDayId,
        ...(endBinding ? { localDate: endBinding.date, timeZone: endBinding.timeZone } : {}) }, entry(trip, item, "end", endBinding ? "date-only" : "unbound", endKey, schedule.endDayId, endBinding?.date, endBinding?.timeZone));
    }
    return;
  }
  if (schedule.type === "day") {
    const dates = datesBetween(schedule.date, schedule.endDate ?? schedule.date);
    dates.forEach((date, index) => {
      const atExclusiveEnd = schedule.endDate !== undefined && date === schedule.endDate;
      const role: DayEntryRole = schedule.endDate === undefined ? "visit" : index === 0 ? "start" : atExclusiveEnd ? "end" : "continue";
      const key = calendarDayKey(date, schedule.timeZone, item.logicalDayId);
      add(buckets, key, { label: date, order: dateOrder(date, order), localDate: date, ...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
        ...(item.logicalDayId ? { logicalDayId: item.logicalDayId } : {}) }, entry(trip, item, role, "date-only", key, item.logicalDayId, date, schedule.timeZone),
      item.type === "stay" && role !== "end");
    });
    return;
  }
  if (schedule.type === "fixed") {
    const startDate = localDate(schedule.startAt), endDate = schedule.endAt ? localDate(schedule.endAt) : startDate;
    const sameZone = schedule.startAt.timeZone === (schedule.endAt?.timeZone ?? schedule.startAt.timeZone);
    const events: { date: string; zone: string; role: DayEntryRole }[] = startDate === endDate && sameZone
      ? [{ date: startDate, zone: schedule.startAt.timeZone, role: "visit" }]
      : sameZone && schedule.endAt ? datesBetween(startDate, endDate).map((date, index, dates) => ({ date, zone: schedule.startAt.timeZone,
        role: index === 0 ? "start" : index === dates.length - 1 ? "end" : "continue" }))
        : [{ date: startDate, zone: schedule.startAt.timeZone, role: "start" }, ...(schedule.endAt ? [{ date: endDate, zone: schedule.endAt.timeZone, role: "end" as const }] : [])];
    events.forEach(({ date, zone, role }) => { const key = calendarDayKey(date, zone, item.logicalDayId);
      add(buckets, key, { label: date, order: dateOrder(date, order), localDate: date, timeZone: zone,
        ...(item.logicalDayId ? { logicalDayId: item.logicalDayId } : {}) }, entry(trip, item, role, "confirmed", key, item.logicalDayId, date, zone)); });
    return;
  }
  const first = localDate(schedule.earliestStart), last = localDate(schedule.latestEnd);
  datesBetween(first, last).forEach((date) => { const zone = schedule.earliestStart.timeZone; const key = calendarDayKey(date, zone, item.logicalDayId);
    add(buckets, key, { label: date, order: dateOrder(date, order), localDate: date, timeZone: zone,
      ...(item.logicalDayId ? { logicalDayId: item.logicalDayId } : {}) }, entry(trip, item, "possible-window", "possible", key, item.logicalDayId, date, zone)); });
}
function entry(trip: Trip, item: ItineraryItem, role: DayEntryRole, placement: DayEntryPlacement, dayKey: string,
  logicalDayId?: string, local?: LocalDate, zone?: string): DayEntry {
  return { entryKey: `${item.id}:${dayKey}:${role}`, sourceItemId: item.id, sourceRevision: trip.revision, role, placement,
    ...(logicalDayId ? { logicalDayId } : {}), ...(local ? { localDate: local } : {}), ...(zone ? { timeZone: zone } : {}) };
}
function add(buckets: Map<string, MutableDay>, key: string, identity: Omit<MutableDay, "dayKey" | "entries" | "overnightRefs">, value: DayEntry, overnight = false): void {
  const bucket = buckets.get(key) ?? { dayKey: key, ...identity, entries: [], overnightRefs: [] };
  if (!bucket.entries.some(({ entryKey }) => entryKey === value.entryKey)) bucket.entries.push(value);
  if (overnight && !bucket.overnightRefs.includes(value.sourceItemId)) bucket.overnightRefs.push(value.sourceItemId);
  buckets.set(key, bucket);
}
function finishDay(day: MutableDay): DayView {
  return { dayKey: day.dayKey, label: day.label, ...(day.logicalDayId ? { logicalDayId: day.logicalDayId } : {}),
    ...(day.localDate ? { localDate: day.localDate } : {}), ...(day.timeZone ? { timeZone: day.timeZone } : {}),
    entries: day.entries, overnightRefs: day.overnightRefs, coverage: { complete: true, omittedCount: 0 },
    ...(!day.entries.length ? { emptyReason: "not-planned" as const } : {}) };
}
function dayOrder(trip: Trip, id: string, fallback: number): number { const index = trip.timeline?.logicalDays.findIndex((d) => d.id === id) ?? -1; return index < 0 ? Number.MAX_SAFE_INTEGER - fallback : index * 10_000 + fallback; }
function dateOrder(date: string, fallback: number): number { return Date.parse(`${date}T00:00:00Z`) + fallback; }
function calendarDayKey(date: string, zone?: string, logical?: string): string { return `date:${date}:${zone ?? "unknown-zone"}${logical ? `:logical:${logical}` : ""}`; }
function datesBetween(start: LocalDate, end: LocalDate): LocalDate[] {
  if (end < start) return [start, end];
  const result: string[] = [];
  for (let at = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`); at <= last && result.length <= 91; at += 86_400_000) result.push(new Date(at).toISOString().slice(0, 10));
  return result;
}
export function localDate(instant: ZonedInstant): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: instant.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant.at));
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
