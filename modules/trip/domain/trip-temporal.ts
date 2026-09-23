import { bindRelativeSchedule, validateItinerarySchedule, type ItinerarySchedule, type TripTimeline } from "./itinerary-schedule";
import type { Trip } from "./trip";

/** Supplied by the application real-time boundary, never by the Viewer simulator. */
export interface TripClock { now(): Date; }
export type TripTemporalPosition = "past" | "current" | "upcoming" | "unknown";
export interface TripTemporalAssessment {
  readonly position: TripTemporalPosition;
  readonly precision: "instant" | "bounded" | "unknown";
  readonly assessedAt: string;
  readonly itemIds: readonly string[];
  /** Clock-derived plan position only. No done/visited or automatic completion. */
  readonly suggestedLifecycle?: "pre_trip" | "in_trip";
}

/** Only adopted schedules are inputs: request dates, legacy notes and execution claims are excluded. */
export function assessTripTime(trip: Pick<Trip, "items" | "lifecycleState" | "timeline">, clock: TripClock): TripTemporalAssessment {
  const now = clock.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Valid real-time Clock required");
  const schedules = trip.items.map(({ schedule }) => { validateItinerarySchedule(schedule); return schedule; });
  const positions = schedules.map((schedule) => positionAt(schedule, now, trip.timeline));
  const exact = schedules.length > 0 && schedules.every((s) => s.type === "fixed" && s.endAt !== undefined);
  let position: TripTemporalPosition = "unknown";
  if (positions.length && !positions.includes("unknown")) {
    position = positions.every((p) => p === "past") ? "past"
      : positions.every((p) => p === "upcoming") ? "upcoming" : "current";
  }
  const terminal = trip.lifecycleState === "cancelled" || trip.lifecycleState === "completed";
  return { position, precision: position === "unknown" ? "unknown" : exact ? "instant" : "bounded",
    assessedAt: now.toISOString(), itemIds: trip.items.map(({ id }) => id),
    ...(!terminal && position === "upcoming" ? { suggestedLifecycle: "pre_trip" as const } : {}),
    ...(!terminal && position === "current" && exact ? { suggestedLifecycle: "in_trip" as const } : {}),
  };
}

export function positionAt(schedule: ItinerarySchedule, now: Date, timeline?: TripTimeline): TripTemporalPosition {
  const timestamp = now.getTime();
  switch (schedule.type) {
    case "unscheduled": return "unknown";
    case "fixed":
      if (timestamp < Date.parse(schedule.startAt.at)) return "upcoming";
      if (!schedule.endAt) return "unknown";
      return timestamp >= Date.parse(schedule.endAt.at) ? "past" : "current";
    case "window":
      return timestamp < Date.parse(schedule.earliestStart.at) ? "upcoming"
        : timestamp >= Date.parse(schedule.latestEnd.at) ? "past" : "current";
    case "day": {
      if (!schedule.timeZone) return "unknown";
      const parts = new Intl.DateTimeFormat("en", { timeZone: schedule.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
      const part = (type: string): string => parts.find((p) => p.type === type)!.value;
      const date = `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
      // Day spans have an exclusive checkout date; single days include the entire local date.
      return date < schedule.date ? "upcoming" : (schedule.endDate ? date >= schedule.endDate : date > schedule.date) ? "past" : "current";
    }
    case "relative": {
      if (!timeline) return "unknown";
      const bound = bindRelativeSchedule(schedule, timeline);
      if (!bound) return "unknown";
      return positionAt({ type: "day", date: bound.date, ...(bound.endDate ? { endDate: bound.endDate } : {}), timeZone: bound.timeZone }, now);
    }
  }
}
