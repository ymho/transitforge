import type { ItineraryItem } from "./trip";
import { validateTripParty, samePartyValue, type TripParty } from "./trip-party";
import { exactKeys } from "./snapshot-validation";
import { nonemptyText, validateTripRequirement, type TripRequirement } from "./trip-requirement";
import { parseIntentScope, intentModalities, intentTargets, type IntentPrecision, type IntentScope, type IntentTarget } from "./conversation-intent";
export type { TripRequirement } from "./trip-requirement";

export interface TripRequest {
  readonly goal?: string;
  readonly constraints: readonly TripConstraint[];
  readonly assumptions: readonly PlanAssumption[];
  readonly party?: TripParty;
  /** Explicit per-trip inhibition of a Profile fallback. This is not a saved
   * preference deletion and carries only verified semantic provenance. */
  readonly profileSuppressions?: readonly ProfileInheritanceSuppression[];
}
export interface ProfileInheritanceSuppression {
  readonly id: string;
  readonly target: IntentTarget;
  readonly scope: IntentScope;
  readonly sourceOperationId: string;
  readonly reason: "explicit_unknown";
}
export interface TripConstraint {
  readonly id: string;
  readonly strength: "hard" | "soft";
  readonly source: "user" | "profile" | "assumption" | "legacy";
  readonly assumptionId?: string;
  readonly scope: ConstraintScope;
  readonly requirement: TripRequirement;
  /** Verified conversation provenance, authored by Application rather than a model. */
  readonly semantic?: {
    readonly version: 1;
    readonly facts: readonly {
      readonly factRef: string;
      readonly sourceOperationId: string;
      readonly target: IntentTarget;
      readonly scope: IntentScope;
      readonly modality: import("./conversation-intent").IntentModality;
      readonly precision: IntentPrecision;
    }[];
  };
}
export type ConstraintScope = (
  | { readonly type: "trip" }
  | { readonly type: "item"; readonly itemId: string }
  | { readonly type: "item-set"; readonly itemIds: readonly string[] }
  | { readonly type: "logical-day"; readonly logicalDayId: string }
  | { readonly type: "all-days" }
  | { readonly type: "segment"; readonly segmentId: string }
) & { readonly participantIds?: readonly string[] };
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
export function validateTripRequest(request: TripRequest, items: readonly ItineraryItem[], refs: {
  readonly logicalDayIds?: ReadonlySet<string>; readonly segmentIds?: ReadonlySet<string>; readonly participantIds?: ReadonlySet<string>;
} = {}): void {
  exactKeys(request, ["goal", "constraints", "assumptions", "party", "profileSuppressions"]);
  if ((request.goal !== undefined && !nonemptyText(request.goal)) || !Array.isArray(request.constraints) || !Array.isArray(request.assumptions)) throw new Error("Invalid Trip request");
  uniqueIds(request.constraints); uniqueIds(request.assumptions);
  if (request.profileSuppressions !== undefined) {
    if (!Array.isArray(request.profileSuppressions) || request.profileSuppressions.length > 24) throw new Error("Invalid profile suppressions");
    uniqueIds(request.profileSuppressions);
    for (const suppression of request.profileSuppressions) {
      exactKeys(suppression, ["id", "target", "scope", "sourceOperationId", "reason"]);
      if (!intentTargets.includes(suppression.target) || suppression.reason !== "explicit_unknown" ||
          typeof suppression.sourceOperationId !== "string" || !suppression.sourceOperationId || suppression.sourceOperationId.length > 200 || /[\u0000-\u001f\u007f]/u.test(suppression.sourceOperationId)) throw new Error("Invalid profile suppression");
      parseIntentScope(suppression.scope);
    }
  }
  if (request.party !== undefined) {
    validateTripParty(request.party);
    const party = request.party;
    if (party.assumptionId !== undefined) {
      const a = request.assumptions.find(({ id }) => id === party.assumptionId);
      if (!a || a.status === "rejected" || !a.affects.some((ref: PlanAssumption["affects"][number]) => ref.type === "party") ||
          a.source !== (party.source === "assumption" ? "model" : party.source)) throw new Error("Invalid party assumption link");
    }
  }
  for (const c of request.constraints) {
    exactKeys(c, ["id", "strength", "source", "assumptionId", "scope", "requirement", "semantic"]);
    if (!["hard", "soft"].includes(c.strength) || !["user", "profile", "assumption", "legacy"].includes(c.source)) throw new Error("Invalid constraint source/strength");
    const keys = c.scope?.type === "item" ? ["type", "itemId", "participantIds"] : c.scope?.type === "item-set" ? ["type", "itemIds", "participantIds"]
      : c.scope?.type === "logical-day" ? ["type", "logicalDayId", "participantIds"] : c.scope?.type === "segment" ? ["type", "segmentId", "participantIds"]
        : ["type", "participantIds"];
    exactKeys(c.scope, keys);
    const scope = c.scope;
    const itemIds = new Set(items.map(({ id }) => id));
    if (scope.type === "item" && !itemIds.has(scope.itemId) || scope.type === "item-set" && (!Array.isArray(scope.itemIds) || !scope.itemIds.length ||
        new Set(scope.itemIds).size !== scope.itemIds.length || scope.itemIds.some((id: string) => !itemIds.has(id))) ||
      scope.type === "logical-day" && refs.logicalDayIds !== undefined && !refs.logicalDayIds.has(scope.logicalDayId) ||
      scope.type === "segment" && refs.segmentIds !== undefined && !refs.segmentIds.has(scope.segmentId) ||
      !["trip", "item", "item-set", "logical-day", "all-days", "segment"].includes(scope.type)) throw new Error("Missing constraint scope");
    if (scope.participantIds !== undefined && (!Array.isArray(scope.participantIds) || !scope.participantIds.length ||
        new Set(scope.participantIds).size !== scope.participantIds.length || refs.participantIds !== undefined && scope.participantIds.some((id: string) => !refs.participantIds!.has(id)))) throw new Error("Missing constraint participant");
    validateTripRequirement(c.requirement);
    if (c.semantic !== undefined) validateSemanticConstraint(c);
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
        if (item.type === "activity" && ref.field === "selection") throw new Error("Activity assumption must affect schedule or place");
        if (a.status === "rejected" && !unresolvedField(item, ref.field)) throw new Error("Rejected assumption still supports an item; resolve it atomically");
      } else if (ref.type === "party") {
        exactKeys(ref, ["type"]);
        if (a.status === "confirmed" && request.party?.assumptionId !== a.id) throw new Error("Party confirmation requires its current value");
        if (a.status === "unconfirmed" && request.party && request.party.assumptionId !== a.id) throw new Error("Party assumption does not support current party");
      } else throw new Error("Unknown assumption effect");
    }
  }
}

function validateSemanticConstraint(constraint: TripConstraint): void {
  const semantic = constraint.semantic!;
  exactKeys(semantic, ["version", "facts"]);
  if (semantic.version !== 1 || constraint.source !== "user" || constraint.assumptionId !== undefined ||
      !Array.isArray(semantic.facts) || !semantic.facts.length || semantic.facts.length > 12) throw new Error("Invalid semantic constraint");
  for (const fact of semantic.facts) {
    exactKeys(fact, ["factRef", "sourceOperationId", "target", "scope", "modality", "precision"]);
    if (![fact.factRef, fact.sourceOperationId].every((value) => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(value)) ||
        !intentTargets.includes(fact.target) || !intentModalities.includes(fact.modality) || !["exact", "approximate", "range", "qualitative"].includes(fact.precision)) throw new Error("Invalid semantic fact reference");
    parseIntentScope(fact.scope);
  }
  if (new Set(semantic.facts.map(({ factRef }) => factRef)).size !== semantic.facts.length) throw new Error("Duplicate semantic fact reference");
}

/** Compare final Request to original; rejection cannot keep the rejected value under a new label. */
export function validatePartyAssumptionTransition(before: TripRequest, after: TripRequest): void {
  for (const a of before.assumptions) {
    if (a.status !== "unconfirmed" || before.party?.assumptionId !== a.id) continue;
    const next = after.assumptions.find(({ id }) => id === a.id);
    if (next?.status === "confirmed" && JSON.stringify(before.party) !== JSON.stringify(after.party)) throw new Error("Confirm must retain the same party");
    if (next?.status === "rejected" && after.party && samePartyValue(before.party, after.party)) throw new Error("Rejected party must be removed or replaced");
  }
}
function uniqueIds(values: readonly { id: string }[]): void {
  if (values.some((v) => !v || !nonemptyText(v.id)) || new Set(values.map(({ id }) => id)).size !== values.length) throw new Error("Missing/duplicate request ID");
}
function unresolvedField(item: ItineraryItem, field: "schedule" | "place" | "selection"): boolean {
  if (field === "schedule") return item.schedule.type === "unscheduled";
  if (item.type === "transport") return item.detail.status === "unresolved";
  if (item.type === "activity") return field === "place" && item.place === undefined;
  return item.selection.status === "unselected" && (field !== "place" || item.selection.place === undefined);
}

/** Active does NOT mean confirmed. Callers must retain assumptionId/status in search context. */
export function effectiveTripConstraints(request: TripRequest, itemId?: string): TripConstraint[] {
  const eligible = request.constraints.filter((c) =>
    (itemId === undefined || c.scope.type === "trip" || c.scope.type === "all-days" ||
      c.scope.type === "item" && c.scope.itemId === itemId || c.scope.type === "item-set" && c.scope.itemIds.includes(itemId)) &&
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
