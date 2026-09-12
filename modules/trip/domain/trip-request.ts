import type { ItineraryItem } from "./trip";
import { exactKeys } from "./snapshot-validation";
import { nonemptyText, validateTripRequirement, type TripRequirement } from "./trip-requirement";
export type { TripRequirement } from "./trip-requirement";

export interface TripRequest {
  readonly goal?: string;
  readonly constraints: readonly TripConstraint[];
  readonly assumptions: readonly PlanAssumption[];
  // party is added here by #411, not represented by a parallel placeholder.
}
export interface TripConstraint {
  readonly id: string;
  readonly strength: "hard" | "soft";
  readonly source: "user" | "profile" | "assumption" | "legacy";
  readonly assumptionId?: string;
  readonly scope: { readonly type: "trip" } | { readonly type: "item"; readonly itemId: string };
  readonly requirement: TripRequirement;
}
export interface PlanAssumption {
  readonly id: string;
  readonly text: string;
  readonly status: "unconfirmed" | "confirmed" | "rejected";
  readonly source: "model" | "profile" | "legacy";
  readonly affects: readonly (
    | { readonly type: "constraint"; readonly constraintId: string }
    | { readonly type: "item"; readonly itemId: string; readonly field: "schedule" | "place" | "selection" }
    | { readonly type: "party" }
  )[];
}

/** Request plus its aggregate references are validated together, not in a separate repository. */
export function validateTripRequest(request: TripRequest, items: readonly ItineraryItem[]): void {
  exactKeys(request, ["goal", "constraints", "assumptions"]);
  if ((request.goal !== undefined && !nonemptyText(request.goal)) || !Array.isArray(request.constraints) || !Array.isArray(request.assumptions)) throw new Error("Invalid Trip request");
  uniqueIds(request.constraints); uniqueIds(request.assumptions);
  for (const c of request.constraints) {
    exactKeys(c, ["id", "strength", "source", "assumptionId", "scope", "requirement"]);
    if (!["hard", "soft"].includes(c.strength) || !["user", "profile", "assumption", "legacy"].includes(c.source)) throw new Error("Invalid constraint source/strength");
    exactKeys(c.scope, c.scope?.type === "trip" ? ["type"] : ["type", "itemId"]);
    const scope = c.scope;
    if (scope.type !== "trip" && (scope.type !== "item" || !items.some(({ id }) => id === scope.itemId))) throw new Error("Missing constraint item");
    validateTripRequirement(c.requirement);
    if (c.source === "assumption" && !c.assumptionId) throw new Error("Assumption source requires a reference");
    if (c.assumptionId !== undefined) {
      const a = request.assumptions.find(({ id }) => id === c.assumptionId);
      if (!a || !a.affects.some((ref: PlanAssumption["affects"][number]) => ref.type === "constraint" && ref.constraintId === c.id) ||
          c.source === "user" || (c.source === "profile" && a.source !== "profile") || (c.source === "legacy" && a.source !== "legacy")) throw new Error("Invalid assumption link");
    }
  }
  for (const a of request.assumptions) {
    exactKeys(a, ["id", "text", "status", "source", "affects"]);
    if (!nonemptyText(a.text) || !["unconfirmed", "confirmed", "rejected"].includes(a.status) ||
        !["model", "profile", "legacy"].includes(a.source) || !Array.isArray(a.affects)) throw new Error("Invalid assumption");
    const refs = new Set<string>();
    for (const ref of a.affects) {
      const key = JSON.stringify(ref);
      if (refs.has(key)) throw new Error("Duplicate assumption effect"); refs.add(key);
      if (ref.type === "constraint") {
        exactKeys(ref, ["type", "constraintId"]);
        if (!request.constraints.some((c) => c.id === ref.constraintId && c.assumptionId === a.id)) throw new Error("Missing reciprocal constraint link");
      } else if (ref.type === "item") {
        exactKeys(ref, ["type", "itemId", "field"]);
        const item = items.find(({ id }) => id === ref.itemId);
        if (!item || !["schedule", "place", "selection"].includes(ref.field)) throw new Error("Missing assumption item/field");
        if (a.status === "rejected" && !unresolvedField(item, ref.field)) throw new Error("Rejected assumption still supports an item; resolve it atomically");
      } else if (ref.type === "party") {
        exactKeys(ref, ["type"]);
        if (a.status === "confirmed") throw new Error("Party confirmation belongs to #411");
      } else throw new Error("Unknown assumption effect");
    }
  }
}
function uniqueIds(values: readonly { id: string }[]): void {
  if (values.some((v) => !v || !nonemptyText(v.id)) || new Set(values.map(({ id }) => id)).size !== values.length) throw new Error("Missing/duplicate request ID");
}
function unresolvedField(item: ItineraryItem, field: "schedule" | "place" | "selection"): boolean {
  if (field === "schedule") return item.schedule.type === "unscheduled";
  if (item.type === "transport") return item.detail.status === "unresolved";
  return item.selection.status === "unselected" && (field !== "place" || item.selection.place === undefined);
}

/** Active does NOT mean confirmed. Callers must retain assumptionId/status in search context. */
export function effectiveTripConstraints(request: TripRequest, itemId?: string): TripConstraint[] {
  const eligible = request.constraints.filter((c) =>
    (itemId === undefined || c.scope.type === "trip" || c.scope.itemId === itemId) &&
    (c.assumptionId === undefined || request.assumptions.some((a) => a.id === c.assumptionId && a.status !== "rejected")));
  return eligible.flatMap((c) => {
    if (c.source !== "profile" && !(c.assumptionId && request.assumptions.find(({ id }) => id === c.assumptionId)?.source === "profile")) return [structuredClone(c)];
    const overrides = eligible.filter((other) => other.source === "user" && other.requirement.type === c.requirement.type &&
      (itemId !== undefined || other.scope.type === "trip" || (c.scope.type === "item" && other.scope.type === "item" && c.scope.itemId === other.scope.itemId)));
    if (c.requirement.type === "mobility") {
      const requirement = Object.fromEntries(Object.entries(c.requirement).filter(([key]) => key === "type" ||
        !overrides.some((other) => Object.entries(other.requirement).some(([otherKey, value]) => sameMobilityAttribute(otherKey, key) && value !== undefined))));
      return Object.keys(requirement).length > 1 ? [structuredClone({ ...c, requirement: requirement as TripRequirement })] : [];
    }
    const superseded = overrides.some((other) => {
      if (c.requirement.type === "experience" && other.requirement.type === "experience") return c.requirement.preference !== undefined
        ? c.requirement.preference === other.requirement.preference : c.requirement.text === other.requirement.text;
      return true;
    });
    return superseded ? [] : [structuredClone(c)];
  });
}

/** Allowed/required/excluded lists describe the same attribute, not unrelated profile defaults. */
function sameMobilityAttribute(left: string, right: string): boolean {
  if (left === right) return true;
  return [["modes", "excludedModes", "requiredModes"], ["allowedServiceTypes", "requiredServiceTypes", "excludedServiceTypes"],
    ["requiredTrainNames", "excludedTrainNames"], ["requiredTrainNumbers", "excludedTrainNumbers"]]
    .some((group) => group.includes(left) && group.includes(right));
}
