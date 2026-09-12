import { exactKeys, validDate, validInstant } from "./snapshot-validation";

/** Validated at the Domain boundary; no year rollover or host-local Date interpretation. */
export type LocalDate = string;
export interface ZonedInstant { readonly at: string; readonly timeZone: string; }
export type ItinerarySchedule =
  | { readonly type: "fixed"; readonly startAt: ZonedInstant; readonly endAt?: ZonedInstant }
  | { readonly type: "window"; readonly earliestStart: ZonedInstant; readonly latestEnd: ZonedInstant; readonly durationMinutes?: number }
  | { readonly type: "day"; readonly date: LocalDate; readonly endDate?: LocalDate; readonly timeZone?: string }
  | { readonly type: "unscheduled" };

export function validateTimeZone(timeZone: string): void {
  if (typeof timeZone !== "string" || !timeZone || /^[+-]/u.test(timeZone)) throw new Error("IANA time zone required");
  // Intl uses the runtime's IANA database, including historical/DST rules, not the host zone.
  new Intl.DateTimeFormat("en", { timeZone }).format(0);
}

/** An explicit offset disambiguates repeated wall times; nonexistent/mismatched wall times fail. */
export function validateZonedInstant(value: ZonedInstant): void {
  exactKeys(value, ["at", "timeZone"]);
  if (!validInstant(value.at)) throw new Error("Offset instant required");
  validateTimeZone(value.timeZone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: value.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value.at));
  const part = (name: Intl.DateTimeFormatPartTypes): string => parts.find(({ type }) => type === name)!.value;
  const local = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
  if (local !== value.at.slice(0, 19)) throw new Error("Offset does not match IANA time zone");
  // -00:00 means unknown local offset (RFC 3339), not a verified UTC offset.
  if (value.at.endsWith("-00:00")) throw new Error("Unknown offset");
}

export function validateItinerarySchedule(schedule: ItinerarySchedule): void {
  exactKeys(schedule, ["type", "startAt", "endAt", "earliestStart", "latestEnd", "durationMinutes", "date", "endDate", "timeZone"]);
  switch (schedule.type) {
    case "fixed":
      exactKeys(schedule, ["type", "startAt", "endAt"]);
      validateZonedInstant(schedule.startAt);
      if (schedule.endAt !== undefined) {
        validateZonedInstant(schedule.endAt);
        if (Date.parse(schedule.endAt.at) < Date.parse(schedule.startAt.at)) throw new Error("End precedes start");
      }
      return;
    case "window": {
      exactKeys(schedule, ["type", "earliestStart", "latestEnd", "durationMinutes"]);
      validateZonedInstant(schedule.earliestStart); validateZonedInstant(schedule.latestEnd);
      const width = (Date.parse(schedule.latestEnd.at) - Date.parse(schedule.earliestStart.at)) / 60_000;
      if (width < 0 || (schedule.durationMinutes !== undefined &&
          (!Number.isSafeInteger(schedule.durationMinutes) || schedule.durationMinutes < 0 || schedule.durationMinutes > width))) {
        throw new Error("Invalid schedule window/duration");
      }
      return;
    }
    case "day":
      exactKeys(schedule, ["type", "date", "endDate", "timeZone"]);
      if (!validDate(schedule.date) || (schedule.endDate !== undefined &&
          (!validDate(schedule.endDate) || schedule.endDate <= schedule.date))) throw new Error("Invalid calendar date span");
      if (schedule.timeZone !== undefined) validateTimeZone(schedule.timeZone);
      return;
    case "unscheduled": exactKeys(schedule, ["type"]); return;
    default: throw new Error("Unknown itinerary schedule");
  }
}

/** Stay dates are authoritative; endDate is checkout (exclusive), never a checkout instant. */
export function projectStaySchedule(checkInDate: LocalDate, checkOutDate: LocalDate, timeZone?: string): Extract<ItinerarySchedule, { type: "day" }> {
  const schedule = { type: "day" as const, date: checkInDate, endDate: checkOutDate,
    ...(timeZone !== undefined ? { timeZone } : {}) };
  validateItinerarySchedule(schedule);
  return schedule;
}

/** Existing rail input is Japan service-day minutes, not civil clock minutes or elapsed from 04:00. */
export function railScheduledInstant(serviceDate: LocalDate, minutes: number): ZonedInstant {
  if (!validDate(serviceDate) || !Number.isSafeInteger(minutes) || minutes < 0) throw new Error("Invalid service date/time");
  // Format service midnight + minutes in its known zone. Never modulo 1440 or use the host zone.
  const local = new Date(Date.parse(`${serviceDate}T00:00:00Z`) + minutes * 60_000).toISOString().slice(0, -1);
  const instant = { at: `${local}+09:00`, timeZone: "Asia/Tokyo" };
  validateZonedInstant(instant);
  return instant;
}

export function sameZonedInstant(left: ZonedInstant, right: ZonedInstant): boolean {
  return left.timeZone === right.timeZone && Date.parse(left.at) === Date.parse(right.at);
}
