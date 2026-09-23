import { projectTripStructure } from "./trip-structure";
import { effectiveTripConstraints, type ConstraintScope, type TripConstraint, type TripRequest } from "./trip-request";
import { validateTrip, type Trip } from "./trip";

export interface ResolvedConstraintScope {
  readonly targetItemIds: readonly string[];
  readonly dayRefs: readonly string[];
  readonly segmentRefs: readonly string[];
  readonly participantRefs: readonly string[];
  readonly completeness: "complete" | "partial" | "unknown";
  readonly missingRefs: readonly string[];
}
export interface EffectiveConstraintResolution {
  readonly constraint: TripConstraint;
  readonly state: "active" | "superseded" | "conflicting";
  readonly reason: "applicable" | "user-override" | "same-scope-conflict";
  readonly relatedConstraintIds: readonly string[];
}

export function resolveConstraintScope(trip: Trip, scope: ConstraintScope): ResolvedConstraintScope {
  validateTrip(trip);
  const itemIds = new Set(trip.items.map(({ id }) => id));
  const missing = new Set<string>(), dayRefs: string[] = [], segmentRefs: string[] = [];
  let targets: string[] = [];
  switch (scope.type) {
    case "trip": targets = [...itemIds]; break;
    case "item": targets = itemIds.has(scope.itemId) ? [scope.itemId] : (missing.add(scope.itemId), []); break;
    case "item-set": targets = scope.itemIds.filter((id) => itemIds.has(id)); scope.itemIds.filter((id) => !itemIds.has(id)).forEach((id) => missing.add(id)); break;
    case "logical-day": {
      dayRefs.push(scope.logicalDayId);
      if (!trip.timeline?.logicalDays.some(({ id }) => id === scope.logicalDayId)) missing.add(scope.logicalDayId);
      targets = trip.items.filter((item) => item.logicalDayId === scope.logicalDayId || item.schedule.type === "relative" && item.schedule.dayId === scope.logicalDayId).map(({ id }) => id);
      break;
    }
    case "all-days": {
      dayRefs.push(...(trip.timeline?.logicalDays.map(({ id }) => id) ?? []));
      targets = trip.items.filter((item) => item.logicalDayId !== undefined || item.schedule.type !== "unscheduled").map(({ id }) => id);
      if (!trip.timeline && !targets.length) missing.add("all-days");
      break;
    }
    case "segment": {
      segmentRefs.push(scope.segmentId);
      const segment = projectTripStructure(trip).segments.find(({ segmentId }) => segmentId === scope.segmentId);
      if (!segment) missing.add(scope.segmentId); else targets = [...segment.sourceItemIds];
      break;
    }
  }
  const knownParticipants = new Set(trip.request.party?.participants?.map(({ id }) => id) ?? []);
  const participantRefs = [...(scope.participantIds ?? [])];
  participantRefs.filter((id) => !knownParticipants.has(id)).forEach((id) => missing.add(id));
  const completeness = missing.size ? targets.length ? "partial" : "unknown" : targets.length ? "complete" : "unknown";
  return structuredClone({ targetItemIds: [...new Set(targets)], dayRefs, segmentRefs, participantRefs, completeness, missingRefs: [...missing] });
}

/** Preserves both sides of same-authority hard conflicts; profile values alone may be superseded. */
export function resolveEffectiveConstraints(request: TripRequest, target?: { readonly itemId?: string }): EffectiveConstraintResolution[] {
  const active = effectiveTripConstraints(request, target?.itemId);
  const eligible = request.constraints.filter((constraint) =>
    (target?.itemId === undefined || constraint.scope.type === "trip" || constraint.scope.type === "all-days" ||
      constraint.scope.type === "item" && constraint.scope.itemId === target.itemId ||
      constraint.scope.type === "item-set" && constraint.scope.itemIds.includes(target.itemId)) &&
    (constraint.assumptionId === undefined || request.assumptions.some(({ id, status }) => id === constraint.assumptionId && status !== "rejected")));
  return eligible.map((constraint) => {
    if (!active.some(({ id }) => id === constraint.id)) {
      const overrides = active.filter((other) => other.source === "user" && other.requirement.type === constraint.requirement.type);
      return { constraint: structuredClone(constraint), state: "superseded" as const, reason: "user-override" as const,
        relatedConstraintIds: overrides.map(({ id }) => id) };
    }
    const peers = active.filter((other) => other.id !== constraint.id && other.strength === "hard" && constraint.strength === "hard" &&
      sameScope(other.scope, constraint.scope) && other.requirement.type === constraint.requirement.type && JSON.stringify(other.requirement) !== JSON.stringify(constraint.requirement));
    if (peers.length && constraint.source === "user" && peers.some(({ source }) => source === "user")) return {
      constraint: structuredClone(constraint), state: "conflicting" as const, reason: "same-scope-conflict" as const, relatedConstraintIds: peers.map(({ id }) => id),
    };
    return { constraint: structuredClone(constraint), state: "active" as const, reason: "applicable" as const, relatedConstraintIds: [] };
  });
}
function sameScope(left: ConstraintScope, right: ConstraintScope): boolean {
  return JSON.stringify({ ...left, participantIds: [...(left.participantIds ?? [])].sort() }) ===
    JSON.stringify({ ...right, participantIds: [...(right.participantIds ?? [])].sort() });
}
