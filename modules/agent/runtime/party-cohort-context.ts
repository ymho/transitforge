import { assertPartyScopeCurrent, assertCohortBaseline, PartyCohortError, type PartyScopeCatalog } from "@raiquora/trip/party-cohorts";
import type { EffectiveIntent } from "./effective-intent";

/** No derived global count or provider adult/child classification is produced. */
export function partyCohortContext(intent?: EffectiveIntent, catalog?: PartyScopeCatalog) {
  const cohorts = intent?.actualConversationFacts.flatMap(fact =>
    fact.target === "party_details" && fact.scope.type === "conversation" && fact.value.kind === "party_cohorts" ? fact.value.cohorts : []) ?? [];
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
