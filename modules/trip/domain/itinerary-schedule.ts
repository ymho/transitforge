import { exactKeys, validDate, validInstant } from "./snapshot-validation";

/** Validated at the Domain boundary; no year rollover or host-local Date interpretation. */
export type LocalDate = string;
export interface ZonedInstant { readonly at: string; readonly timeZone: string; }
export const relativeDayParts = ["morning", "afternoon", "evening", "overnight"] as const;
export type RelativeDayPart = typeof relativeDayParts[number];
export interface DurationRange { readonly minimum: number; readonly maximum: number; }
export interface LogicalDay {
  readonly id: string;
  readonly label?: string;
}
export interface CalendarBinding {
  readonly logicalDayId: string;
  readonly date: LocalDate;
  readonly timeZone: string;
  /** Explicit means authored/provider-confirmed. Sequential is derived from a named anchor policy. */
  readonly basis: "explicit" | "sequential";
}
export interface TripTimeline {
  readonly version: 1;
  readonly logicalDays: readonly LogicalDay[];
  readonly calendarBindings: readonly CalendarBinding[];
}
export type ItinerarySchedule =
  | { readonly type: "fixed"; readonly startAt: ZonedInstant; readonly endAt?: ZonedInstant }
  | { readonly type: "window"; readonly earliestStart: ZonedInstant; readonly latestEnd: ZonedInstant; readonly durationMinutes?: number }
  | { readonly type: "day"; readonly date: LocalDate; readonly endDate?: LocalDate; readonly timeZone?: string }
  | { readonly type: "relative"; readonly dayId: string; readonly part?: RelativeDayPart; readonly durationMinutes?: DurationRange; readonly endDayId?: string }
  | { readonly type: "unscheduled" };

export interface BoundRelativeSchedule {
  readonly dayId: string;
  readonly date: LocalDate;
  readonly timeZone: string;
  readonly part?: RelativeDayPart;
  readonly durationMinutes?: DurationRange;
  readonly endDayId?: string;
  readonly endDate?: LocalDate;
  readonly endTimeZone?: string;
}

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
  exactKeys(schedule, ["type", "startAt", "endAt", "earliestStart", "latestEnd", "durationMinutes", "date", "endDate", "timeZone", "dayId", "part", "endDayId"]);
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
    case "relative":
      exactKeys(schedule, ["type", "dayId", "part", "durationMinutes", "endDayId"]);
      logicalDayId(schedule.dayId);
      if (schedule.part !== undefined && !relativeDayParts.includes(schedule.part)) throw new Error("Invalid relative day part");
      if (schedule.durationMinutes !== undefined) validateDurationRange(schedule.durationMinutes);
      if (schedule.endDayId !== undefined) logicalDayId(schedule.endDayId);
      return;
    case "unscheduled": exactKeys(schedule, ["type"]); return;
    default: throw new Error("Unknown itinerary schedule");
  }
}

export function validateTripTimeline(timeline: TripTimeline): void {
  exactKeys(timeline, ["version", "logicalDays", "calendarBindings"]);
  if (timeline.version !== 1 || !Array.isArray(timeline.logicalDays) || !timeline.logicalDays.length ||
      !Array.isArray(timeline.calendarBindings)) throw new Error("Invalid Trip timeline");
  const ids = new Set<string>();
  for (const day of timeline.logicalDays) {
    exactKeys(day, ["id", "label"]); logicalDayId(day.id);
    if (ids.has(day.id)) throw new Error("Duplicate logical day");
    ids.add(day.id);
    if (day.label !== undefined && (typeof day.label !== "string" || !day.label.trim() || day.label.length > 80)) throw new Error("Invalid logical day label");
  }
  const bindings = new Set<string>();
  for (const binding of timeline.calendarBindings) {
    exactKeys(binding, ["logicalDayId", "date", "timeZone", "basis"]);
    if (!ids.has(binding.logicalDayId) || bindings.has(binding.logicalDayId) || !validDate(binding.date) ||
        !["explicit", "sequential"].includes(binding.basis)) throw new Error("Invalid calendar binding");
    validateTimeZone(binding.timeZone); bindings.add(binding.logicalDayId);
  }
}

/** Aggregate-level validation: schedules never invent or retain dangling logical-day references. */
export function validateScheduleReferences(schedule: ItinerarySchedule, timeline?: TripTimeline, logicalDayIdRef?: string): void {
  if (logicalDayIdRef !== undefined) logicalDayId(logicalDayIdRef);
  if (schedule.type !== "relative" && logicalDayIdRef === undefined) return;
  if (!timeline) throw new Error("Logical day requires a Trip timeline");
  const ids = new Set(timeline.logicalDays.map(({ id }) => id));
  for (const id of [logicalDayIdRef, schedule.type === "relative" ? schedule.dayId : undefined,
    schedule.type === "relative" ? schedule.endDayId : undefined]) {
    if (id !== undefined && !ids.has(id)) throw new Error("Missing logical day reference");
  }
  if (schedule.type === "relative" && schedule.endDayId !== undefined &&
      timeline.logicalDays.findIndex(({ id }) => id === schedule.endDayId) < timeline.logicalDays.findIndex(({ id }) => id === schedule.dayId)) {
    throw new Error("Relative schedule end precedes start");
  }
}

/** Bind calendar labels without upgrading a conceptual part-of-day to a fixed clock time. */
export function bindRelativeSchedule(schedule: Extract<ItinerarySchedule, { type: "relative" }>, timeline: TripTimeline): BoundRelativeSchedule | undefined {
  validateTripTimeline(timeline); validateItinerarySchedule(schedule); validateScheduleReferences(schedule, timeline);
  const byDay = new Map(timeline.calendarBindings.map((binding) => [binding.logicalDayId, binding]));
  const start = byDay.get(schedule.dayId), end = schedule.endDayId === undefined ? undefined : byDay.get(schedule.endDayId);
  if (!start || schedule.endDayId !== undefined && !end) return undefined;
  return structuredClone({ dayId: schedule.dayId, date: start.date, timeZone: start.timeZone,
    ...(schedule.part === undefined ? {} : { part: schedule.part }),
    ...(schedule.durationMinutes === undefined ? {} : { durationMinutes: schedule.durationMinutes }),
    ...(schedule.endDayId === undefined ? {} : { endDayId: schedule.endDayId, endDate: end!.date, endTimeZone: end!.timeZone }) });
}

/** Explicit opt-in policy. It never infers a zone from a title/place and can be removed losslessly. */
export function bindTimelineFromAnchor(timeline: TripTimeline, anchorDayId: string, date: LocalDate, timeZone: string): TripTimeline {
  validateTripTimeline(timeline); logicalDayId(anchorDayId);
  if (!validDate(date)) throw new Error("Invalid calendar anchor"); validateTimeZone(timeZone);
  const anchor = timeline.logicalDays.findIndex(({ id }) => id === anchorDayId);
  if (anchor < 0) throw new Error("Missing calendar anchor day");
  const explicit = new Map(timeline.calendarBindings.filter(({ basis }) => basis === "explicit").map((binding) => [binding.logicalDayId, binding]));
  const calendarBindings = timeline.logicalDays.map((day, index) => explicit.get(day.id) ?? {
    logicalDayId: day.id, date: addLocalDays(date, index - anchor), timeZone, basis: "sequential" as const,
  });
  const result = { ...timeline, calendarBindings }; validateTripTimeline(result); return structuredClone(result);
}

export function clearSequentialCalendarBindings(timeline: TripTimeline): TripTimeline {
  validateTripTimeline(timeline);
  return structuredClone({ ...timeline, calendarBindings: timeline.calendarBindings.filter(({ basis }) => basis === "explicit") });
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function logicalDayId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(value)) throw new Error("Invalid logical day ID");
}
function validateDurationRange(value: DurationRange): void {
  exactKeys(value, ["minimum", "maximum"]);
  if (!Number.isSafeInteger(value.minimum) || !Number.isSafeInteger(value.maximum) || value.minimum < 0 ||
      value.maximum < value.minimum || value.maximum > 525_600) throw new Error("Invalid duration range");
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
