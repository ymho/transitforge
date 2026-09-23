import { validateTripWatch, monitoringKey, type TripWatch } from "./trip-watch";
import type { ItinerarySchedule } from "./itinerary-schedule";
import { forecastHourInstant } from "./weather-event-fact";

/** Execution policy, not an appointment or a change to the planned schedule. */
export const recheckPolicyVersion = "trip-recheck-v1";
export type RecheckKind = "weather" | "hazard" | "rail-refresh" | "readiness";
const day = 86_400_000, hour = 3_600_000;
export function recheckKind(watch: TripWatch): Exclude<RecheckKind, "readiness"> {
  return watch.subject.type === "rail-service" ? "rail-refresh" : watch.subject.type === "weather-area" ? "weather" : "hazard";
}
export function recheckIdentity(tripId: string, revision: number, kind: RecheckKind, watchId?: string): string {
  return monitoringKey([recheckPolicyVersion, tripId, revision, kind, watchId ?? "target-resolution"]);
}

/** Conservative scheduler envelope only. Date precision remains date precision in Watch/Trip/Impact. */
export function recheckEnvelope(schedule: ItinerarySchedule): { start: number; end: number } | undefined {
  switch (schedule.type) {
    case "fixed": return { start: Date.parse(schedule.startAt.at), end: Date.parse(schedule.endAt?.at ?? schedule.startAt.at) + hour };
    case "window": return { start: Date.parse(schedule.earliestStart.at), end: Date.parse(schedule.latestEnd.at) + hour };
    case "day": return { start: Date.parse(`${schedule.date}T00:00:00Z`) - 14 * hour,
      end: Date.parse(`${schedule.endDate ?? addRecheckDays(schedule.date, 1)}T00:00:00Z`) + 14 * hour };
    case "unscheduled": return undefined;
    case "relative": return undefined;
  }
}
/** undefined = ended; unknown schedule is attempted once then handled as unknown/retry, not fetched blindly. */
export function nextRecheckAt(watch: TripWatch, now: number, afterSuccess = false): number | undefined {
  validateTripWatch(watch);
  const span = recheckEnvelope(watch.activeWindow);
  if (!span) return now;
  if (span.end < now) return undefined;
  const kind = recheckKind(watch), distance = span.start - now;
  const schedule = watch.activeWindow;
  const zone = schedule.type === "fixed" ? schedule.startAt.timeZone : schedule.type === "window" ? schedule.earliestStart.timeZone : schedule.type === "day" ? schedule.timeZone : undefined;
  if (kind === "weather" && zone) {
    const date = schedule.type === "day" ? schedule.date : recheckLocalDate(span.start, zone);
    // Provider horizon advances at local midnight, not at the planned appointment's clock time.
    const horizonEntry = Date.parse(forecastHourInstant(`${addRecheckDays(date, -15)}T00:00`, zone));
    if (now < horizonEntry) return horizonEntry;
  }
  const lead = kind === "weather" ? 15 * day : kind === "hazard" ? day : hour;
  if (distance > lead && !(kind === "weather" && zone)) return span.start - lead;
  if (!afterSuccess) return now;
  const cadence = kind === "weather" ? (distance > 7 * day ? 6 * hour : distance > day ? hour : 30 * 60_000)
    : kind === "hazard" ? (distance > 0 ? hour : 5 * 60_000) : 2 * 60_000;
  return now + cadence > span.end ? undefined : now + cadence;
}
export function addRecheckDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * day).toISOString().slice(0, 10);
}
export function recheckLocalDate(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}
/** Six calendar days/chunk: even a DST fallback stays below 168 hourly samples. At most three chunks/horizon. */
export function recheckForecastRanges(schedule: ItinerarySchedule, timeZone: string, now: number) {
  const span = recheckEnvelope(schedule);
  if (!span) return [];
  const today = recheckLocalDate(now, timeZone), horizon = addRecheckDays(today, 15);
  const first = schedule.type === "day" ? schedule.date : recheckLocalDate(span.start, timeZone);
  const last = schedule.type === "day" ? addRecheckDays(schedule.endDate ?? addRecheckDays(schedule.date, 1), -1)
    : recheckLocalDate(span.end, timeZone);
  const end = last < horizon ? last : horizon;
  const ranges: { startDate: string; endDate: string }[] = [];
  for (let start = first > today ? first : today; start <= end; start = addRecheckDays(start, 6)) {
    const limit = addRecheckDays(start, 5);
    ranges.push({ startDate: start, endDate: limit < end ? limit : end });
  }
  return ranges;
}
