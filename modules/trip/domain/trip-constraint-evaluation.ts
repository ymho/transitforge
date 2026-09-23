import { validateTrip, type Trip, type ItineraryItem } from "./trip";
import { effectiveTripConstraints } from "./trip-request";
import type { DateRange, MobilityRequirement, TripRequirement } from "./trip-requirement";
import { samePlaceIdentity } from "./place-snapshot";
import { bindRelativeSchedule, type ItinerarySchedule, type ZonedInstant } from "./itinerary-schedule";
import { projectTripPlaces } from "./trip-places";
import type { PlaceSnapshot } from "./place-snapshot";
import { addMoney, compareMoney, validateMoney, type Money } from "./money";
import { resolveConstraintScope, resolveEffectiveConstraints } from "./trip-constraint-scope";

/** Trusted, complete adopted-item costs, after external freshness/subject validation. */
export interface TripConstraintFacts {
  costs?: readonly { itemId: string; total: Money }[];
  metrics?: readonly { scopeRef: string; metric: "travel_minutes" | "walking_minutes" | "transfer_count";
    knownLowerBound: number; upperBound?: number; completeness: "complete" | "partial" | "unknown"; sourceFactRefs: readonly string[] }[];
}

export type ConstraintEvaluationStatus = "satisfied" | "violated" | "unknown";
export interface TripConstraintEvaluation {
  constraintId: string;
  status: ConstraintEvaluationStatus;
  reasonCode: "planned_facts" | "insufficient_planned_facts" | "unconfirmed_assumption";
}
export interface ScopedConstraintEvaluation extends TripConstraintEvaluation {
  readonly evaluatedTargetRefs: readonly string[];
  readonly unknownTargetRefs: readonly string[];
  readonly sourceFactRefs: readonly string[];
  readonly conflictConstraintIds: readonly string[];
}

/** Planned facts only. Not candidate assessment (#406) or whole-trip feasibility (#402).
 * Trip-scoped mobility limits apply to each movement, not outbound + return summed together.
 * An empty result means no effective hard constraints, NOT a feasible/completed trip.
 */
export function evaluateTripHardConstraints(trip: Trip, facts: TripConstraintFacts = {}): TripConstraintEvaluation[] {
  return evaluateScopedTripConstraints(trip, facts).map(({ constraintId, status, reasonCode }) => ({ constraintId, status, reasonCode }));
}

export function evaluateScopedTripConstraints(trip: Trip, facts: TripConstraintFacts = {}): ScopedConstraintEvaluation[] {
  validateTrip(trip);
  return resolveEffectiveConstraints(trip.request).filter(({ constraint, state }) => constraint.strength === "hard" && state !== "superseded").map((resolved) => {
    const c = resolved.constraint;
    const scope = resolveConstraintScope(trip, c.scope);
    const base = { constraintId: c.id, evaluatedTargetRefs: scope.targetItemIds, unknownTargetRefs: scope.missingRefs,
      sourceFactRefs: [] as string[], conflictConstraintIds: resolved.relatedConstraintIds };
    if (resolved.state === "conflicting") return { ...base, status: "unknown" as const, reasonCode: "insufficient_planned_facts" as const };
    if (c.assumptionId && trip.request.assumptions.find((a) => a.id === c.assumptionId)?.status === "unconfirmed") {
      return { ...base, status: "unknown", reasonCode: "unconfirmed_assumption" };
    }
    const items = trip.items.filter((item) => scope.targetItemIds.includes(item.id));
    if (c.scope.type === "trip" && items.some((item) => {
      const scoped = effectiveTripConstraints(trip.request, item.id).find((condition) => condition.id === c.id);
      return !scoped || JSON.stringify(scoped.requirement) !== JSON.stringify(c.requirement);
    })) {
      // A trip-wide profile condition with item-specific overrides is not a uniform predicate.
      // Do not declare a user override violated by reapplying the profile globally (#402 owns composition).
      return { ...base, status: "unknown", reasonCode: "insufficient_planned_facts" };
    }
    if (scope.completeness === "unknown") return { ...base, status: "unknown", reasonCode: "insufficient_planned_facts" };
    const aggregate = c.requirement.type === "aggregate_metric" ? evaluateAggregate(c.requirement, c.scope.type === "all-days" ? scope.dayRefs :
      c.scope.type === "logical-day" ? [c.scope.logicalDayId] : c.scope.type === "segment" ? [c.scope.segmentId] : scope.targetItemIds, facts) : undefined;
    const status = aggregate?.status ?? evaluate(c.requirement, items, trip, facts);
    return { ...base, status: scope.completeness === "partial" && status === "satisfied" ? "unknown" : status,
      reasonCode: status === "unknown" || scope.completeness === "partial" ? "insufficient_planned_facts" : "planned_facts",
      sourceFactRefs: aggregate?.sourceFactRefs ?? [] };
  });
}

function evaluateAggregate(requirement: Extract<TripRequirement, { type: "aggregate_metric" }>, scopeRefs: readonly string[], facts: TripConstraintFacts): { status: ConstraintEvaluationStatus; sourceFactRefs: string[] } {
  const applicable = scopeRefs.map((scopeRef) => facts.metrics?.find((fact) => fact.scopeRef === scopeRef && fact.metric === requirement.metric));
  if (!scopeRefs.length || applicable.some((fact) => !fact)) return { status: "unknown", sourceFactRefs: [] };
  const values = applicable as NonNullable<TripConstraintFacts["metrics"]>;
  const lower = values.reduce((sum, fact) => sum + fact.knownLowerBound, 0);
  const upperKnown = values.every((fact) => fact.completeness === "complete" && fact.upperBound !== undefined);
  const upper = upperKnown ? values.reduce((sum, fact) => sum + fact.upperBound!, 0) : undefined;
  return { status: lower > requirement.maximum ? "violated" : upper !== undefined && upper <= requirement.maximum ? "satisfied" : "unknown",
    sourceFactRefs: [...new Set(values.flatMap(({ sourceFactRefs }) => sourceFactRefs))] };
}

function evaluate(requirement: TripRequirement, items: readonly ItineraryItem[], trip: Trip, facts: TripConstraintFacts): ConstraintEvaluationStatus {
  if (!items.length) return "unknown";
  switch (requirement.type) {
    case "origin": case "destinations": {
      const places = projectTripPlaces(trip).visitedPlaces.filter((p) => items.some((i) => i.id === p.itemId)).map((p) => p.place);
      // Consecutive endpoint/activity representations are one visit, not proof of a return visit.
      const visits = places.filter((p, index) => !index || !samePlaceIdentity(p.ref, places[index - 1]!.ref));
      if (requirement.type === "origin") {
        const origin = projectTripPlaces(trip).visitedPlaces.find((p) => p.itemId === items[0]!.id)?.place;
        return origin ? identity(requirement.place, origin) : "unknown";
      }
      let cursor = 0;
      const results = requirement.places.map((wanted) => {
        const candidates = requirement.order === "fixed" ? visits.slice(cursor) : visits;
        const found = candidates.findIndex((p) => samePlaceIdentity(wanted.ref, p.ref));
        if (found >= 0) { if (requirement.order === "fixed") cursor += found + 1; return "satisfied" as const; }
        const incomplete = items.some((i) => i.type === "transport" ? i.detail.status === "unresolved" :
          i.type === "stay" ? i.selection.status === "unselected" : !i.place);
        return incomplete || !visits.length || visits.some((p) => identity(wanted, p) === "unknown") ? "unknown" as const : "violated" as const;
      });
      return combine(results);
    }
    case "duration": {
      const first = items[0]!.schedule, last = items.at(-1)!.schedule;
      const zone = (s: ItinerarySchedule) => s.type === "fixed" ? s.startAt.timeZone : s.type === "window" ? s.earliestStart.timeZone : s.type === "day" ? s.timeZone
        : s.type === "relative" && trip.timeline ? bindRelativeSchedule(s, trip.timeline)?.timeZone : undefined;
      const tz = zone(first);
      if (!tz || !zone(last)) return "unknown";
      const start = dateBounds(first, false, tz, trip), end = dateBounds(last, true, tz, trip);
      if (!start || !end) return "unknown";
      const adjustment = requirement.unit === "days" ? 1 : 0;
      const min = (Date.parse(end[0]) - Date.parse(start[1])) / 86_400_000 + adjustment;
      const max = (Date.parse(end[1]) - Date.parse(start[0])) / 86_400_000 + adjustment;
      if (max < requirement.minimum || min > requirement.maximum) return "violated";
      return min >= requirement.minimum && max <= requirement.maximum ? "satisfied" : "unknown";
    }
    case "budget": {
      try {
        const costs = items.map((item) => facts.costs?.filter((c) => c.itemId === item.id) ?? []);
        // Even a selected stay's reference-minimum is not a complete trip/room/party price.
        if (costs.some((entries) => entries.length !== 1)) return "unknown";
        const amounts = costs.map((entries) => entries[0]!.total); amounts.forEach(validateMoney);
        let total = amounts[0]!;
        for (const amount of amounts.slice(1)) total = addMoney(total, amount);
        let limit = requirement.limit;
        if (requirement.basis === "per-person") {
          const party = trip.request.party;
          if (!party || party.assumptionId && trip.request.assumptions.find((a) => a.id === party.assumptionId)?.status !== "confirmed") return "unknown";
          limit = { currency: limit.currency, amountMinor: limit.amountMinor * (party.adults + party.children.length) };
          validateMoney(limit);
        }
        return compareMoney(total, limit) <= 0 ? "satisfied" : "violated";
      } catch { return "unknown"; } // Mixed currency/overflow are not implicit FX/zero.
    }
    case "dates": {
      // Item order is adopted itinerary order. Missing intermediate schedules can conceal a date conflict.
      const start = dateBounds(items[0]!.schedule, false, requirement.timeZone, trip);
      const end = dateBounds(items.at(-1)!.schedule, true, requirement.timeZone, trip);
      return combine([withinRange(start, requirement.start), ...(requirement.end ? [withinRange(end, requirement.end)] : []),
        ...(items.some((item) => item.schedule.type === "unscheduled") ? ["unknown" as const] : [])]);
    }
    case "arrive_by": case "depart_after": {
      const times: number[] = [];
      let missing = false;
      for (const item of items) {
        if (item.type !== "transport") continue;
        if (item.detail.status !== "selected") { missing = true; continue; }
        if (item.detail.mode !== "rail") {
          const arrival = requirement.type === "arrive_by";
          const place = arrival ? item.detail.destination : item.detail.origin;
          if (!place.ref || place.ref.provider === "manual" || (!place.ref.providerPlaceId && !place.ref.canonicalKey)) {
            missing = true; continue; // Cannot exclude this unknown endpoint from the requested place.
          }
          if (samePlaceIdentity(place.ref, requirement.place.ref)) {
            const instant = item.schedule.type === "fixed" ? (arrival ? item.schedule.endAt : item.schedule.startAt) : undefined;
            if (instant) times.push(Date.parse(instant.at)); else missing = true;
          }
          continue;
        }
        for (const leg of item.detail.journey.legs) {
          const arrival = requirement.type === "arrive_by";
          if (samePlaceIdentity((arrival ? leg.destination : leg.origin).ref, requirement.place.ref)) {
            times.push(Date.parse((arrival ? leg.scheduledArrival : leg.scheduledDeparture).at));
          }
        }
      }
      if (!times.length) return "unknown";
      const satisfied = requirement.type === "arrive_by" ? Math.max(...times) <= Date.parse(requirement.at.at)
        : Math.min(...times) >= Date.parse(requirement.at.at);
      return !satisfied ? "violated" : missing ? "unknown" : "satisfied";
    }
    case "mobility": {
      const movements = items.filter((item) => item.type === "transport");
      if (!movements.length) return "unknown";
      const required: ConstraintEvaluationStatus = requirement.requiredModes === undefined ? "satisfied" :
        requirement.requiredModes.every((mode) => movements.some((item) => item.detail.status === "selected" && item.detail.mode === mode)) ? "satisfied" :
          movements.some((item) => item.detail.status === "unresolved") ? "unknown" : "violated";
      return combine([required, ...movements.map((item) => {
        if (item.detail.status !== "selected") return "unknown";
        const journey = item.detail.mode === "rail" ? item.detail.journey : undefined;
        const minutes = item.schedule.type === "fixed" && item.schedule.endAt ?
          (Date.parse(item.schedule.endAt.at) - Date.parse(item.schedule.startAt.at)) / 60_000 : undefined;
        return combine(Object.entries(requirement).filter(([key, value]) => key !== "type" && value !== undefined).map(([key]) => {
          switch (key as keyof MobilityRequirement) {
            case "maxTransfers": return !journey ? "unknown" : journey.transfers.length <= requirement.maxTransfers! ? "satisfied" : "violated";
            case "maxTravelMinutes": return minutes === undefined ? "unknown" : minutes <= requirement.maxTravelMinutes! ? "satisfied" : "violated";
            case "modes": return requirement.modes!.includes(item.detail.mode!) ? "satisfied" : "violated";
            case "excludedModes": return requirement.excludedModes!.includes(item.detail.mode!) ? "violated" : "satisfied";
            case "requiredModes": return required;
            case "excludedServiceUids": return !journey ? "unknown" : journey.legs.some((leg) => requirement.excludedServiceUids!.includes(leg.serviceUid)) ? "violated" : "satisfied";
            case "excludedTrainNumbers": return !journey ? "unknown" : journey.legs.some((leg) => requirement.excludedTrainNumbers!.includes(leg.trainNumber)) ? "violated" : "satisfied";
            case "requiredTrainNumbers": return !journey ? "unknown" : requirement.requiredTrainNumbers!.every((number) => journey.legs.some((leg) => leg.trainNumber === number)) ? "satisfied" : "violated";
            case "transferPace": return journey?.provenance.transferPace === requirement.transferPace ? "satisfied" : "unknown";
            // Ranking, car availability, names/service types are not established by this snapshot.
            default: return "unknown";
          }
        }));
      })]);
    }
    case "aggregate_metric": return "unknown";
    // Natural-language experiences and unimplemented fact comparisons must never count as proven.
    default: return "unknown";
  }
}

function identity(a: PlaceSnapshot, b: PlaceSnapshot): ConstraintEvaluationStatus {
  if (samePlaceIdentity(a.ref, b.ref)) return "satisfied";
  // Different providers/unknown identifiers cannot prove either equivalence or difference.
  const x = a.ref, y = b.ref;
  return x && y && x.provider !== "manual" && x.provider === y.provider &&
    (x.providerPlaceId && y.providerPlaceId || x.canonicalKey && y.canonicalKey) ? "violated" : "unknown";
}

function combine(values: ConstraintEvaluationStatus[]): ConstraintEvaluationStatus {
  return values.includes("violated") ? "violated" : !values.length || values.includes("unknown") ? "unknown" : "satisfied";
}
function withinRange(bounds: [string, string] | undefined, range: DateRange): ConstraintEvaluationStatus {
  if (!bounds) return "unknown";
  if (bounds[1] < range.earliest || bounds[0] > range.latest) return "violated";
  return bounds[0] >= range.earliest && bounds[1] <= range.latest ? "satisfied" : "unknown";
}
function dateBounds(schedule: ItinerarySchedule, end: boolean, zone?: string, trip?: Trip): [string, string] | undefined {
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
  if (schedule.type === "relative" && trip?.timeline) {
    const bound = bindRelativeSchedule(schedule, trip.timeline);
    if (!bound || zone && zone !== (end ? bound.endTimeZone ?? bound.timeZone : bound.timeZone)) return undefined;
    const value = end ? bound.endDate ?? bound.date : bound.date;
    return [value, value];
  }
  return undefined;
}
