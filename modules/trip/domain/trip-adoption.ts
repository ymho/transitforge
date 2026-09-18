import type { Trip, TripUpdateProposal } from "./trip";
import { assessTripTime, type TripClock } from "./trip-temporal";
import { exactKeys, validInstant } from "./snapshot-validation";

/** User intent only; neither a feasibility certificate nor a booking/execution fact. */
export interface TripAdoption { readonly confirmedAt: string; readonly needsReconfirmation?: true; }
export type TripAdoptionAction = "confirm" | "withdraw";

export function validateTripAdoption(value: TripAdoption): void {
  exactKeys(value, ["confirmedAt", "needsReconfirmation"]);
  if (!validInstant(value.confirmedAt) || value.needsReconfirmation !== undefined && value.needsReconfirmation !== true) {
    throw new Error("Invalid trip adoption");
  }
}

/** Exact preview confirmation is supplied separately by a trusted interaction host. */
export function tripAdoptionConfirmationKey(proposal: TripUpdateProposal): string { return JSON.stringify(proposal); }

export function canConfirmTrip(trip: Pick<Trip, "items" | "lifecycleState">): boolean {
  return !["cancelled", "completed"].includes(trip.lifecycleState) && trip.items.length > 0 &&
    trip.items.every(({ schedule }) => schedule.type !== "unscheduled" && (schedule.type !== "day" || !!schedule.timeZone));
}

/** Compare plan semantics, not copy or explanatory labels. Prices/notes in separate resources do not invalidate intent. */
export function adoptionNeedsReview(before: Trip, after: Trip): boolean {
  const relevant = (trip: Trip) => ({
    items: trip.items.map(({ title: _title, ...item }) => item),
    party: trip.request.party,
    conditions: trip.request.constraints.filter(({ requirement }) =>
      ["origin", "destinations", "dates", "duration", "depart_after", "arrive_by", "mobility"].includes(requirement.type)),
  });
  return JSON.stringify(relevant(before)) !== JSON.stringify(relevant(after));
}

export type TripDisplayGroup = "next" | "scheduled" | "current" | "planning" | "past-plan" | "completed" | "cancelled";
export interface ClassifiedTrip { readonly trip: Trip; readonly group: TripDisplayGroup; readonly temporal: ReturnType<typeof assessTripTime>; }

/** One read selector for Home/list/detail. Calendar precision is retained; ordering is not an appointment time. */
export function classifyTrips(trips: readonly Trip[], clock: TripClock): ClassifiedTrip[] {
  const now = clock.now();
  const rows: ClassifiedTrip[] = trips.map((trip) => {
    const temporal = assessTripTime(trip, { now: () => now });
    const adopted = trip.adoption !== undefined && !trip.adoption.needsReconfirmation;
    const group: TripDisplayGroup = trip.lifecycleState === "completed" ? "completed"
      : trip.lifecycleState === "cancelled" ? "cancelled"
      : temporal.position === "past" ? "past-plan"
      : !adopted ? "planning"
      : temporal.position === "current" ? "current"
      : temporal.position === "upcoming" ? "scheduled" : "planning";
    return { trip, temporal, group };
  });
  const key = (trip: Trip): string => trip.items.map(({ schedule }) => {
    if (schedule.type === "fixed" || schedule.type === "window") {
      const instant = schedule.type === "fixed" ? schedule.startAt : schedule.earliestStart;
      const parts = new Intl.DateTimeFormat("en", { timeZone: instant.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant.at));
      const part = (type: string) => parts.find((p) => p.type === type)!.value;
      // Display calendar ordering only: never infer a departure time for a day schedule.
      return `${part("year")}-${part("month")}-${part("day")}:${new Date(instant.at).toISOString()}`;
    }
    // Day precision has no departure instant; stable calendar ordering, not invented midnight.
    return schedule.type === "day" ? schedule.date : "~";
  }).sort()[0] ?? "~";
  rows.sort((a, b) => key(a.trip).localeCompare(key(b.trip)) || a.trip.id.localeCompare(b.trip.id));
  const next = rows.find((row) => row.group === "scheduled");
  return rows.map((row) => row === next ? { ...row, group: "next" } : row);
}
