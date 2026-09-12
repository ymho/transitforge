import { validateTrip, type Trip, type ItineraryItem } from "./trip";
import { effectiveTripConstraints } from "./trip-request";
import type { DateRange, MobilityRequirement, TripRequirement } from "./trip-requirement";
import { samePlaceIdentity } from "./place-snapshot";
import type { ItinerarySchedule, ZonedInstant } from "./itinerary-schedule";

export type ConstraintEvaluationStatus = "satisfied" | "violated" | "unknown";
export interface TripConstraintEvaluation {
  constraintId: string;
  status: ConstraintEvaluationStatus;
  reasonCode: "planned_facts" | "insufficient_planned_facts" | "unconfirmed_assumption";
}

/** Planned facts only. Not candidate assessment (#406) or whole-trip feasibility (#402).
 * Trip-scoped mobility limits apply to each movement, not outbound + return summed together.
 * An empty result means no effective hard constraints, NOT a feasible/completed trip.
 */
export function evaluateTripHardConstraints(trip: Trip): TripConstraintEvaluation[] {
  validateTrip(trip);
  return effectiveTripConstraints(trip.request).filter((c) => c.strength === "hard").map((c) => {
    if (c.assumptionId && trip.request.assumptions.find((a) => a.id === c.assumptionId)?.status === "unconfirmed") {
      return { constraintId: c.id, status: "unknown", reasonCode: "unconfirmed_assumption" };
    }
    const scope = c.scope;
    const items = scope.type === "trip" ? trip.items : trip.items.filter((item) => item.id === scope.itemId);
    if (scope.type === "trip" && items.some((item) => {
      const scoped = effectiveTripConstraints(trip.request, item.id).find((condition) => condition.id === c.id);
      return !scoped || JSON.stringify(scoped.requirement) !== JSON.stringify(c.requirement);
    })) {
      // A trip-wide profile condition with item-specific overrides is not a uniform predicate.
      // Do not declare a user override violated by reapplying the profile globally (#402 owns composition).
      return { constraintId: c.id, status: "unknown", reasonCode: "insufficient_planned_facts" };
    }
    const status = evaluate(c.requirement, items);
    return { constraintId: c.id, status, reasonCode: status === "unknown" ? "insufficient_planned_facts" : "planned_facts" };
  });
}

function evaluate(requirement: TripRequirement, items: readonly ItineraryItem[]): ConstraintEvaluationStatus {
  if (!items.length) return "unknown";
  switch (requirement.type) {
    case "dates": {
      // Item order is adopted itinerary order. Missing intermediate schedules can conceal a date conflict.
      if (items.some((item) => item.schedule.type === "unscheduled")) return "unknown";
      const start = dateBounds(items[0]!.schedule, false, requirement.timeZone);
      const end = dateBounds(items.at(-1)!.schedule, true, requirement.timeZone);
      return combine([withinRange(start, requirement.start), ...(requirement.end ? [withinRange(end, requirement.end)] : [])]);
    }
    case "arrive_by": case "depart_after": {
      const times: number[] = [];
      let missing = false;
      for (const item of items) {
        if (item.type !== "transport") continue;
        if (item.detail.status !== "selected") { missing = true; continue; }
        for (const leg of item.detail.journey.legs) {
          const arrival = requirement.type === "arrive_by";
          if (samePlaceIdentity((arrival ? leg.destination : leg.origin).ref, requirement.place.ref)) {
            times.push(Date.parse((arrival ? leg.scheduledArrival : leg.scheduledDeparture).at));
          }
        }
      }
      if (!times.length || missing) return "unknown"; // Name-only places do not prove identity.
      return (requirement.type === "arrive_by" ? Math.max(...times) <= Date.parse(requirement.at.at)
        : Math.min(...times) >= Date.parse(requirement.at.at)) ? "satisfied" : "violated";
    }
    case "mobility": {
      const movements = items.filter((item) => item.type === "transport");
      if (!movements.length) return "unknown";
      return combine(movements.map((item) => {
        if (item.detail.status !== "selected") return "unknown";
        const journey = item.detail.journey;
        const minutes = (Date.parse(journey.legs.at(-1)!.scheduledArrival.at) - Date.parse(journey.legs[0]!.scheduledDeparture.at)) / 60_000;
        return combine(Object.entries(requirement).filter(([key, value]) => key !== "type" && value !== undefined).map(([key]) => {
          switch (key as keyof MobilityRequirement) {
            case "maxTransfers": return journey.transfers.length <= requirement.maxTransfers! ? "satisfied" : "violated";
            case "maxTravelMinutes": return minutes <= requirement.maxTravelMinutes! ? "satisfied" : "violated";
            case "modes": return requirement.modes!.includes("rail") ? "satisfied" : "violated";
            case "excludedModes": return requirement.excludedModes!.includes("rail") ? "violated" : "satisfied";
            case "requiredModes": return requirement.requiredModes!.every((mode) => mode === "rail") ? "satisfied" : "violated";
            case "excludedServiceUids": return journey.legs.some((leg) => requirement.excludedServiceUids!.includes(leg.serviceUid)) ? "violated" : "satisfied";
            case "excludedTrainNumbers": return journey.legs.some((leg) => requirement.excludedTrainNumbers!.includes(leg.trainNumber)) ? "violated" : "satisfied";
            case "requiredTrainNumbers": return requirement.requiredTrainNumbers!.every((number) => journey.legs.some((leg) => leg.trainNumber === number)) ? "satisfied" : "violated";
            case "transferPace": return journey.provenance.transferPace === requirement.transferPace ? "satisfied" : "unknown";
            // Ranking, car availability, names/service types are not established by this snapshot.
            default: return "unknown";
          }
        }));
      }));
    }
    // Natural-language experiences and unimplemented fact comparisons must never count as proven.
    default: return "unknown";
  }
}

function combine(values: ConstraintEvaluationStatus[]): ConstraintEvaluationStatus {
  return values.includes("violated") ? "violated" : !values.length || values.includes("unknown") ? "unknown" : "satisfied";
}
function withinRange(bounds: [string, string] | undefined, range: DateRange): ConstraintEvaluationStatus {
  if (!bounds) return "unknown";
  if (bounds[1] < range.earliest || bounds[0] > range.latest) return "violated";
  return bounds[0] >= range.earliest && bounds[1] <= range.latest ? "satisfied" : "unknown";
}
function dateBounds(schedule: ItinerarySchedule, end: boolean, zone?: string): [string, string] | undefined {
  const civilDate = (instant: ZonedInstant): string => {
    if (!zone || zone === instant.timeZone) return instant.at.slice(0, 10);
    const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant.at));
    return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
  };
  if (schedule.type === "day") {
    if (zone && zone !== schedule.timeZone) return undefined;
    const value = end ? schedule.endDate ?? schedule.date : schedule.date;
    return [value, value];
  }
  if (schedule.type === "fixed") {
    const instant = end ? schedule.endAt : schedule.startAt;
    return instant ? [civilDate(instant), civilDate(instant)] : undefined;
  }
  if (schedule.type === "window") return [civilDate(schedule.earliestStart), civilDate(schedule.latestEnd)];
  return undefined;
}
