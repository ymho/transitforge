import { assertPartyScopeCurrent, assertCohortBaseline, PartyCohortError, type PartyScopeCatalog } from "@raiquora/trip/party-cohorts";
import type { EffectiveIntent } from "./effective-intent";

/** No derived global count or provider adult/child classification is produced. */
export function partyCohortContext(intent?: EffectiveIntent, catalog?: PartyScopeCatalog) {
  const cohorts = currentCohorts(intent);
  if (!cohorts.length) return { status: "none" as const };
  try {
    assertPartyScopeCurrent(cohorts, catalog);
    const people = partyBaselineCount(intent);
    if (people !== undefined) assertCohortBaseline(cohorts, people);
    return { status: cohorts.some(cohort => cohort.scope.kind !== "whole_trip") ? "scoped" as const : "global" as const,
      providerQualifications: "unconfirmed" as const };
  } catch (error) {
    if (error instanceof PartyCohortError) return { status: "unconfirmed" as const, reason: error.code };
    throw error;
  }
}

/** Lossless, read-only projection of current conditions into the Tool's input
 * vocabulary. The model does not have to reverse-map private day/segment IDs.
 * A stale or non-contiguous scope is not broadened into an editable range. */
export function partyCohortEditableValue(intent?: EffectiveIntent, catalog?: PartyScopeCatalog) {
  const applicability = partyCohortContext(intent, catalog);
  if (applicability.status === "none" || applicability.status === "unconfirmed") return null;
  const projected = currentCohorts(intent).map(cohort => {
    const { scope, ...attributes } = cohort;
    if (scope.kind === "whole_trip") return { ...attributes, scope: { kind: "whole_trip" as const } };
    if (!catalog) return null;
    if (scope.kind === "segment") {
      const index = catalog.segments.findIndex(segment => segment.id === scope.segmentId);
      return index < 0 ? null : { ...attributes, scope: { kind: "segment" as const, segmentNumber: index + 1 } };
    }
    const indexes = scope.dayIds.map(id => catalog.days.findIndex(day => day.id === id)).sort((a, b) => a - b);
    if (!indexes.length || indexes[0]! < 0 || indexes.some((index, offset) => index !== indexes[0]! + offset)) return null;
    return { ...attributes, scope: { kind: "logical_days" as const, fromDay: indexes[0]! + 1, toDay: indexes[indexes.length - 1]! + 1 } };
  });
  return projected.every(cohort => cohort !== null) ? projected : null;
}

function currentCohorts(intent?: EffectiveIntent) {
  return intent?.actualConversationFacts.flatMap(fact =>
    fact.target === "party_details" && fact.scope.type === "conversation" && fact.value.kind === "party_cohorts" ? fact.value.cohorts : []) ?? [];
}

/** Existing global-count readers cannot yet express a day/segment-specific party.
 * Refuse that lossy projection rather than silently manufacture a global total. */
export function partyCohortReadBoundary(intent: EffectiveIntent | undefined, dependencies: readonly string[], catalog?: PartyScopeCatalog): string | undefined {
  if (!dependencies.includes("party_size") && !dependencies.includes("party_details")) return undefined;
  const context = partyCohortContext(intent, catalog);
  if (context.status === "unconfirmed") return context.reason;
  if (context.status === "scoped") return "product_participation_scope_required";
  return undefined;
}

export function partyBaselineCount(intent?: EffectiveIntent): number | undefined {
    const fact = intent?.actualConversationFacts.find(fact => fact.target === "party_size" && fact.scope.type === "conversation")?.value;
    const base = intent?.activeBaseParty?.authority === "persisted_user" ? intent.activeBaseParty.value : undefined;
    return fact?.kind === "quantity" && fact.unit === "people" ? fact.amount : fact?.kind === "party" ? fact.adults + fact.children.length
      : base ? base.adults + base.children.length : undefined;
}
