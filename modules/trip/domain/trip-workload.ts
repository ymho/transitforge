import type { DailyItineraryProjection } from "./daily-itinerary";
import { validateTrip, type Trip } from "./trip";

export type MeasureCompleteness = "complete" | "partial" | "unknown";
export interface WorkloadMeasure {
  readonly metricId: string;
  readonly unit: "minutes" | "meters" | "count";
  readonly knownLowerBound: number;
  readonly upperBound?: number;
  readonly completeness: MeasureCompleteness;
  readonly sourceItemIds: readonly string[];
  readonly observationRefs: readonly string[];
  readonly excluded: readonly { readonly itemId: string; readonly reason: "unknown-duration" | "outside-day" | "not-applicable" }[];
  readonly calculationVersion: 1;
}
export interface DayWorkloadMetrics {
  readonly dayKey: string;
  readonly sourceRevision: number;
  readonly travelMinutes: WorkloadMeasure;
  readonly walkingMinutes: WorkloadMeasure;
  readonly walkingMeters: WorkloadMeasure;
  readonly transferCount: WorkloadMeasure;
  readonly fixedAppointmentCount: WorkloadMeasure;
  readonly lodgingChangeCount: WorkloadMeasure;
  readonly earlyLateCount: WorkloadMeasure;
  readonly scheduleSlackMinutes: WorkloadMeasure;
  readonly consecutiveActivityMinutes: WorkloadMeasure;
}
export interface MovementFact {
  readonly itemId: string;
  readonly walkingMinutes?: { readonly minimum: number; readonly maximum?: number };
  readonly walkingMeters?: { readonly minimum: number; readonly maximum?: number };
  readonly observationRefs: readonly string[];
}
export interface WorkloadPolicy { readonly earlyBeforeHour?: number; readonly lateAfterHour?: number }
export interface TripWorkload {
  readonly version: 1;
  readonly sourceTripId: string;
  readonly sourceRevision: number;
  readonly days: readonly DayWorkloadMetrics[];
  readonly tripTravelMinutes: WorkloadMeasure;
  readonly complexity: "O(items log items + days * items)";
}

/** Derived metrics, never a physiological score. Unknown movement remains coverage loss, never zero. */
export function measureTripWorkload(trip: Trip, daily: DailyItineraryProjection, facts: readonly MovementFact[] = [], policy: WorkloadPolicy = {}): TripWorkload {
  validateTrip(trip);
  if (daily.sourceTripId !== trip.id || daily.sourceRevision !== trip.revision) throw new Error("Stale daily projection");
  const factByItem = new Map(facts.map((fact) => [fact.itemId, fact]));
  if (factByItem.size !== facts.length || facts.some((fact) => !trip.items.some(({ id }) => id === fact.itemId))) throw new Error("Invalid movement facts");
  const transports = trip.items.filter((item) => item.type === "transport");
  const unknownTransports = transports.filter((item) => item.schedule.type !== "fixed" || !item.schedule.endAt);
  const knownTransports = transports.filter((item): item is typeof item & { schedule: { type: "fixed"; startAt: { at: string; timeZone: string }; endAt: { at: string; timeZone: string } } } =>
    item.schedule.type === "fixed" && item.schedule.endAt !== undefined);
  const tripTravelMinutes = measure("trip:travel", "minutes", knownTransports.reduce((sum, item) => sum + elapsed(item.schedule.startAt.at, item.schedule.endAt.at), 0),
    unknownTransports.length ? knownTransports.length ? "partial" : "unknown" : "complete", knownTransports.map(({ id }) => id), [],
    unknownTransports.map(({ id }) => ({ itemId: id, reason: "unknown-duration" as const })));
  const days = daily.days.map((day): DayWorkloadMetrics => {
    const ids = new Set(day.entries.map(({ sourceItemId }) => sourceItemId));
    const dayItems = trip.items.filter(({ id }) => ids.has(id));
    const knownTravel = knownTransports.flatMap((item) => {
      if (!day.localDate || !day.timeZone) return [];
      const start = startOfLocalDay(day.localDate, day.timeZone), end = startOfNextLocalDay(day.localDate, day.timeZone);
      const clipped = Math.max(0, Math.min(Date.parse(item.schedule.endAt.at), end) - Math.max(Date.parse(item.schedule.startAt.at), start)) / 60_000;
      return clipped > 0 ? [{ id: item.id, minutes: clipped }] : [];
    });
    const unknownDayTravel = unknownTransports.filter(({ id }) => ids.has(id));
    const travel = measure(`${day.dayKey}:travel`, "minutes", knownTravel.reduce((sum, v) => sum + v.minutes, 0),
      unknownDayTravel.length ? knownTravel.length ? "partial" : "unknown" : "complete", knownTravel.map(({ id }) => id), [],
      unknownDayTravel.map(({ id }) => ({ itemId: id, reason: "unknown-duration" as const })));
    const dayFacts = [...ids].flatMap((id) => factByItem.get(id) ? [factByItem.get(id)!] : []);
    const missingWalking = [...ids].filter((id) => trip.items.find((item) => item.id === id)?.type === "transport" && !factByItem.has(id));
    const walkingMinutes = rangeMeasure(`${day.dayKey}:walking-minutes`, "minutes", dayFacts, "walkingMinutes", missingWalking);
    const walkingMeters = rangeMeasure(`${day.dayKey}:walking-meters`, "meters", dayFacts, "walkingMeters", missingWalking);
    const rails = dayItems.flatMap((item) => item.type === "transport" && item.detail.status === "selected" && item.detail.mode === "rail"
      ? [{ id: item.id, transferCount: item.detail.journey.transfers.length }] : []);
    const unknownTransfer = dayItems.filter((item) => item.type === "transport" && (item.detail.status !== "selected" || item.detail.mode !== "rail"));
    const transferCount = measure(`${day.dayKey}:transfers`, "count", rails.reduce((sum, item) => sum + item.transferCount, 0),
      unknownTransfer.length ? rails.length ? "partial" : "unknown" : "complete", rails.map(({ id }) => id), [], unknownTransfer.map(({ id }) => ({ itemId: id, reason: "unknown-duration" as const })));
    const fixed = dayItems.filter((item) => item.schedule.type === "fixed");
    const staysStarting = day.entries.filter(({ role, sourceItemId }) => role === "start" && trip.items.find((item) => item.id === sourceItemId)?.type === "stay");
    const earlyBefore = policy.earlyBeforeHour ?? 7, lateAfter = policy.lateAfterHour ?? 22;
    const earlyLate = fixed.filter((item) => { const hour = localHour(item.schedule.type === "fixed" ? item.schedule.startAt.at : "", item.schedule.type === "fixed" ? item.schedule.startAt.timeZone : "UTC"); return hour < earlyBefore || hour >= lateAfter; });
    const intervals = fixed.flatMap((item) => item.schedule.type === "fixed" && item.schedule.endAt ? [{ id: item.id, start: Date.parse(item.schedule.startAt.at), end: Date.parse(item.schedule.endAt.at) }] : []).sort((a, b) => a.start - b.start);
    const gaps = intervals.slice(1).map((current, index) => Math.max(0, current.start - intervals[index]!.end) / 60_000);
    const consecutive = intervalUnionMinutes(intervals);
    return { dayKey: day.dayKey, sourceRevision: trip.revision, travelMinutes: travel, walkingMinutes, walkingMeters, transferCount,
      fixedAppointmentCount: measure(`${day.dayKey}:fixed`, "count", fixed.length, "complete", fixed.map(({ id }) => id)),
      lodgingChangeCount: measure(`${day.dayKey}:lodging-change`, "count", staysStarting.length, "complete", staysStarting.map(({ sourceItemId }) => sourceItemId)),
      earlyLateCount: measure(`${day.dayKey}:early-late`, "count", earlyLate.length, "complete", earlyLate.map(({ id }) => id)),
      scheduleSlackMinutes: measure(`${day.dayKey}:slack`, "minutes", gaps.reduce((sum, gap) => sum + gap, 0), unknownDayTravel.length ? "partial" : "complete", intervals.map(({ id }) => id)),
      consecutiveActivityMinutes: measure(`${day.dayKey}:continuous`, "minutes", consecutive, "complete", intervals.map(({ id }) => id)) };
  });
  return structuredClone({ version: 1, sourceTripId: trip.id, sourceRevision: trip.revision, days, tripTravelMinutes,
    complexity: "O(items log items + days * items)" });
}
function measure(metricId: string, unit: WorkloadMeasure["unit"], lower: number, completeness: MeasureCompleteness, sourceItemIds: string[], observationRefs: string[] = [], excluded: WorkloadMeasure["excluded"] = [], upper?: number): WorkloadMeasure {
  return { metricId, unit, knownLowerBound: lower, ...(upper === undefined ? {} : { upperBound: upper }), completeness,
    sourceItemIds: [...new Set(sourceItemIds)], observationRefs: [...new Set(observationRefs)], excluded, calculationVersion: 1 };
}
function rangeMeasure(metricId: string, unit: "minutes" | "meters", facts: MovementFact[], key: "walkingMinutes" | "walkingMeters", missing: string[]): WorkloadMeasure {
  const known = facts.flatMap((fact) => fact[key] ? [{ itemId: fact.itemId, range: fact[key]!, refs: fact.observationRefs }] : []);
  const lower = known.reduce((sum, value) => sum + value.range.minimum, 0);
  const allUpper = known.every(({ range }) => range.maximum !== undefined);
  return measure(metricId, unit, lower, missing.length ? known.length ? "partial" : "unknown" : "complete", known.map(({ itemId }) => itemId),
    known.flatMap(({ refs }) => refs), missing.map((itemId) => ({ itemId, reason: "unknown-duration" as const })), allUpper ? known.reduce((sum, value) => sum + value.range.maximum!, 0) : undefined);
}
function elapsed(start: string, end: string): number { return (Date.parse(end) - Date.parse(start)) / 60_000; }
function intervalUnionMinutes(intervals: readonly { start: number; end: number }[]): number {
  let total = 0, start: number | undefined, end: number | undefined;
  for (const interval of intervals) { if (start === undefined || interval.start > end!) { if (start !== undefined) total += end! - start; start = interval.start; end = interval.end; } else end = Math.max(end!, interval.end); }
  return (total + (start === undefined ? 0 : end! - start)) / 60_000;
}
function localHour(at: string, zone: string): number { return Number(new Intl.DateTimeFormat("en", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(new Date(at))); }
function startOfLocalDay(date: string, zone: string): number { return localWallTimeToInstant(`${date}T00:00:00`, zone); }
function startOfNextLocalDay(date: string, zone: string): number { const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); return startOfLocalDay(next, zone); }
function localWallTimeToInstant(local: string, zone: string): number {
  const target = Date.parse(`${local}Z`); let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const get = (type: string) => parts.find((part) => part.type === type)!.value;
    const represented = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
    guess += target - represented;
  }
  return guess;
}
