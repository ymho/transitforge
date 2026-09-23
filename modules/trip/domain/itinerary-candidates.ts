import { validateItinerarySchedule, type ItinerarySchedule } from "./itinerary-schedule";
import type { Money } from "./money";
import type { ItineraryItem, Trip, TripUpdateProposal } from "./trip";
import { applyTripProposal, validateTrip } from "./trip";

export interface CandidateSetContextRef {
  readonly conversationId: string;
  readonly requestFingerprint: string;
  readonly tripId?: string;
  readonly baseTripRevision?: number;
}
export interface DraftTimeline { readonly dayOrder: readonly string[]; readonly itemOrder: readonly string[] }
export interface DraftPlanItem {
  readonly componentId: string;
  readonly kind: "transport" | "stay" | "activity";
  readonly title: string;
  readonly schedule: ItinerarySchedule;
  readonly logicalDayId?: string;
  readonly sourceCandidateRef?: string;
  readonly sourcePlaceRef?: string;
  readonly evidenceRefs: readonly string[];
  readonly exclusiveGroupRef?: string;
  /** Existing adopted item to replace; absence means a new item. */
  readonly baseItemId?: string;
  /** Required only for new items. afterRef is an adopted item ID or an earlier component ID. */
  readonly placement?: { readonly atBeginning: true } | { readonly afterRef: string };
}
export interface PlanCoverage { readonly coveredScopes: readonly string[]; readonly omittedScopes: readonly string[]; readonly complete: boolean }
export interface PlanVariant {
  readonly id: string;
  readonly label: string;
  readonly timeline: DraftTimeline;
  readonly items: readonly DraftPlanItem[];
  readonly assumptionRefs: readonly string[];
  readonly assessmentRefs: readonly string[];
  readonly basedOnVariantId?: string;
  readonly changedComponentIds: readonly string[];
  readonly removedBaseItemIds: readonly string[];
  readonly retainedBaseItemIds: readonly string[];
  readonly condition?: { readonly kind: "rain" | "clear" | "budget-change" | "custom"; readonly assumptionRef: string };
  readonly discoveryRefs?: readonly string[];
}
export interface ItineraryCandidateSet {
  readonly id: string;
  readonly revision: number;
  readonly contextRef: CandidateSetContextRef;
  readonly variants: readonly PlanVariant[];
  readonly coverage: PlanCoverage;
  readonly issuedAt: string;
  readonly expiresAt: string;
}
export interface CandidateDiscoveryBatch {
  readonly hits: readonly { readonly hitId: string; readonly sourceRef: string; readonly originalRank: number }[];
}

export interface PlanVariantAssessment {
  readonly variantId: string;
  readonly hardConstraints: { readonly status: "satisfied" | "violated" | "unknown"; readonly refs: readonly string[] };
  readonly unknowns: readonly string[];
  readonly softPreferences: readonly { readonly ref: string; readonly status: "matched" | "conflicted" | "unknown" }[];
  readonly workload: { readonly status: "known" | "partial" | "unknown"; readonly travelMinutes?: number; readonly sourceRef?: string };
  readonly cost: { readonly status: "known" | "partial" | "unknown" | "mixed-currency"; readonly totals: readonly Money[]; readonly sourceRefs: readonly string[] };
  readonly evidenceCoverage: { readonly covered: number; readonly total: number; readonly sourceRefs: readonly string[] };
  readonly changeAmount: { readonly changedComponents: number; readonly protectedChanges: number; readonly refetches: number };
  readonly robustness?: { readonly assessmentRef: string; readonly factsVersion: string; readonly normalStatus: "feasible" | "infeasible" | "unknown"; readonly scenarioStatuses: readonly { scenarioRef: string; status: "feasible" | "infeasible" | "unknown"; affectedItemIds: readonly string[] }[] };
}
export interface PlanVariantComparison { readonly variants: readonly PlanVariantAssessment[]; readonly paretoFront: readonly string[]; readonly dominatedBy: Readonly<Record<string, readonly string[]>>; readonly rankingPolicy: "multi-axis-v1"; readonly noOverallScore: true }

export function createItineraryCandidateSet(value: ItineraryCandidateSet): ItineraryCandidateSet {
  validateCandidateSet(value); return structuredClone(value);
}
export function validateCandidateSet(value: ItineraryCandidateSet): void {
  stableId(value.id);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !value.contextRef.conversationId || !value.contextRef.requestFingerprint ||
      value.contextRef.baseTripRevision !== undefined && (!Number.isSafeInteger(value.contextRef.baseTripRevision) || value.contextRef.baseTripRevision < 0) ||
      !validInstant(value.issuedAt) || !validInstant(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt) || !value.variants.length) throw new Error("Invalid candidate set");
  const variantIds = new Set<string>();
  for (const variant of value.variants) {
    stableId(variant.id); if (variantIds.has(variant.id)) throw new Error("Duplicate variant"); variantIds.add(variant.id);
    const ids = new Set(variant.items.map(({ componentId }) => componentId));
    if (ids.size !== variant.items.length || variant.timeline.itemOrder.length !== ids.size || variant.timeline.itemOrder.some((id) => !ids.has(id)) ||
        variant.changedComponentIds.some((id) => !ids.has(id)) || new Set(variant.timeline.dayOrder).size !== variant.timeline.dayOrder.length ||
        new Set([...variant.removedBaseItemIds, ...variant.retainedBaseItemIds]).size !== variant.removedBaseItemIds.length + variant.retainedBaseItemIds.length) throw new Error("Invalid variant timeline");
    for (const item of variant.items) {
      stableId(item.componentId); validateItinerarySchedule(item.schedule);
      if (!item.title.trim() || !["transport", "stay", "activity"].includes(item.kind) || item.baseItemId !== undefined && !item.baseItemId.trim()) throw new Error("Invalid draft item");
      if (item.placement && "afterRef" in item.placement && !item.placement.afterRef.trim()) throw new Error("Invalid draft placement");
    }
    const exclusive = new Map<string, number>();
    for (const item of variant.items) if (item.exclusiveGroupRef) exclusive.set(item.exclusiveGroupRef, (exclusive.get(item.exclusiveGroupRef) ?? 0) + 1);
    if ([...exclusive.values()].some((count) => count > 1)) throw new Error("Mutually exclusive alternatives cannot coexist");
  }
  for (const variant of value.variants) if (variant.basedOnVariantId && !variantIds.has(variant.basedOnVariantId)) throw new Error("Missing base variant");
}

/** A hard violation is never compensated by cost, relevance, or preference. Unknown stays visible. */
export function comparePlanVariants(assessments: readonly PlanVariantAssessment[]): PlanVariantComparison {
  if (!assessments.length || new Set(assessments.map(({ variantId }) => variantId)).size !== assessments.length) throw new Error("Invalid variant assessments");
  const dominatedBy: Record<string, string[]> = {};
  for (const candidate of assessments) dominatedBy[candidate.variantId] = assessments.filter((other) => other !== candidate && dominates(other, candidate)).map(({ variantId }) => variantId).sort();
  return { variants: structuredClone([...assessments].sort((a, b) => a.variantId.localeCompare(b.variantId))),
    paretoFront: assessments.filter((item) => !dominatedBy[item.variantId]!.length).map(({ variantId }) => variantId).sort(), dominatedBy,
    rankingPolicy: "multi-axis-v1", noOverallScore: true };
}

export interface DiverseCandidate {
  readonly variantId: string; readonly discoveryRef: string; readonly placeIdentity?: string; readonly regionRef?: string;
  readonly styleRefs: readonly string[]; readonly workloadBand?: string; readonly budgetBand?: string;
  readonly retrievalRelevance: number; readonly hardStatus: "satisfied" | "violated" | "unknown";
}
export interface DiversityCriteria { readonly version: 1; readonly maximum: number; readonly fixedRegionRef?: string; readonly relevanceWeight: number; readonly diversityWeight: number }
export function selectDiverseCandidates(candidates: readonly DiverseCandidate[], criteria: DiversityCriteria) {
  if (!Number.isSafeInteger(criteria.maximum) || criteria.maximum <= 0 || criteria.maximum > 20 || criteria.relevanceWeight < 0 || criteria.diversityWeight < 0) throw new Error("Invalid diversity policy");
  const accepted: DiverseCandidate[] = [], rejected: { variantId: string; reason: string }[] = [];
  const identities = new Set<string>();
  let remaining = [...candidates];
  while (remaining.length && accepted.length < criteria.maximum) {
    const eligible = remaining.filter((candidate) => (!criteria.fixedRegionRef || candidate.regionRef === criteria.fixedRegionRef) && candidate.hardStatus !== "violated" && (!candidate.placeIdentity || !identities.has(candidate.placeIdentity)));
    if (!eligible.length) break;
    const scored = eligible.map((candidate) => ({ candidate, score: criteria.relevanceWeight * candidate.retrievalRelevance + criteria.diversityWeight * novelty(candidate, accepted) }))
      .sort((a, b) => b.score - a.score || a.candidate.variantId.localeCompare(b.candidate.variantId));
    const chosen = scored[0]!.candidate; accepted.push(chosen); if (chosen.placeIdentity) identities.add(chosen.placeIdentity);
    remaining = remaining.filter(({ variantId }) => variantId !== chosen.variantId);
  }
  for (const candidate of remaining) rejected.push({ variantId: candidate.variantId, reason: criteria.fixedRegionRef && candidate.regionRef !== criteria.fixedRegionRef ? "outside-explicit-region" :
    candidate.hardStatus === "violated" ? "hard-constraint-violated" : candidate.placeIdentity && identities.has(candidate.placeIdentity) ? "duplicate-resolved-place" : "selection-budget" });
  return { policyVersion: criteria.version, selectedVariantIds: accepted.map(({ variantId }) => variantId), rejected, incomplete: candidates.length > accepted.length + rejected.length };
}

/** Keeps retrieval provenance without treating retrieval rank as recommendation rank. */
export function mapDiscoveryToVariantRefs(batch: CandidateDiscoveryBatch, mappings: readonly { hitId: string; variantId: string; resolvedPlaceRef?: string }[]) {
  const hits = new Map(batch.hits.map((hit) => [hit.hitId, hit]));
  return mappings.map((mapping) => { const hit = hits.get(mapping.hitId); if (!hit) throw new Error("Unknown discovery hit"); return {
    discoveryRef: mapping.hitId, variantId: mapping.variantId, sourceRef: hit.sourceRef, retrievalRank: hit.originalRank,
    ...(mapping.resolvedPlaceRef ? { resolvedPlaceRef: mapping.resolvedPlaceRef } : {}), retrievalOnly: true as const }; });
}

/** Trusted factory validates provider results before they become adopted items. This function only creates a Proposal. */
export function proposePlanAdoption(input: { candidateSet: ItineraryCandidateSet; variantId: string; currentTrip: Trip; requestFingerprint: string; now: string;
  trustedFactory: (draft: DraftPlanItem) => ItineraryItem }): { proposal: TripUpdateProposal; componentMap: readonly { componentId: string; itemId: string }[] } {
  validateCandidateSet(input.candidateSet); validateTrip(input.currentTrip);
  const context = input.candidateSet.contextRef;
  if (!validInstant(input.now) || Date.parse(input.now) > Date.parse(input.candidateSet.expiresAt) || context.requestFingerprint !== input.requestFingerprint ||
      context.tripId !== input.currentTrip.id || context.baseTripRevision !== input.currentTrip.revision) throw new Error("Stale or foreign candidate set");
  const variant = input.candidateSet.variants.find(({ id }) => id === input.variantId); if (!variant) throw new Error("Unknown variant");
  const componentMap: { componentId: string; itemId: string }[] = [], patches: TripUpdateProposal["patches"][number][] = [];
  const currentIds = new Set(input.currentTrip.items.map(({ id }) => id));
  if ([...variant.removedBaseItemIds, ...variant.retainedBaseItemIds, ...variant.items.flatMap(({ baseItemId }) => baseItemId ? [baseItemId] : [])].some((id) => !currentIds.has(id))) throw new Error("Candidate references unknown base item");
  if (variant.items.flatMap(({ baseItemId }) => baseItemId ? [baseItemId] : []).some((id, index, all) => all.indexOf(id) !== index) ||
      variant.removedBaseItemIds.some((id) => variant.retainedBaseItemIds.includes(id) || variant.items.some(({ baseItemId }) => baseItemId === id)) ||
      variant.items.some(({ baseItemId }) => baseItemId && variant.retainedBaseItemIds.includes(baseItemId))) throw new Error("Ambiguous candidate base mapping");
  for (const itemId of variant.removedBaseItemIds) patches.push({ type: "remove", itemId });
  const componentToItem = new Map<string, string>();
  for (const componentId of variant.timeline.itemOrder) {
    const draft = variant.items.find((item) => item.componentId === componentId)!;
    const item = input.trustedFactory(structuredClone(draft)); componentMap.push({ componentId, itemId: item.id });
    if (draft.baseItemId) {
      if (item.id !== draft.baseItemId) throw new Error("Replacement factory must preserve adopted item ID");
      if (draft.placement) throw new Error("Replacement placement is inherited from its base item");
      patches.push({ type: "replace", itemId: draft.baseItemId, item }); componentToItem.set(componentId, item.id);
    } else {
      if (!draft.placement) throw new Error("New candidate item requires explicit placement");
      if ("atBeginning" in draft.placement && (input.currentTrip.items.length > variant.removedBaseItemIds.length || componentToItem.size)) throw new Error("Current Proposal contract cannot insert before an existing first item");
      const afterId = "atBeginning" in draft.placement ? undefined : componentToItem.get(draft.placement.afterRef) ?? (currentIds.has(draft.placement.afterRef) ? draft.placement.afterRef : undefined);
      if (!("atBeginning" in draft.placement) && (!afterId || variant.removedBaseItemIds.includes(afterId))) throw new Error("Candidate placement anchor is unavailable");
      patches.push({ type: "add", item, ...(afterId ? { afterId } : {}) }); componentToItem.set(componentId, item.id);
    }
  }
  const proposal: TripUpdateProposal = { tripId: input.currentTrip.id, baseRevision: input.currentTrip.revision, summary: `候補 ${variant.id} を採用する`, patches };
  // Validate the complete aggregate before exposing an adoption preview; persistence still requires explicit confirmation and CAS.
  applyTripProposal(input.currentTrip, proposal);
  return { proposal, componentMap };
}

function dominates(left: PlanVariantAssessment, right: PlanVariantAssessment): boolean {
  const hard = { violated: 0, unknown: 1, satisfied: 2 } as const;
  if (hard[left.hardConstraints.status] < hard[right.hardConstraints.status]) return false;
  const leftCurrency = left.cost.status === "known" && left.cost.totals.length === 1 ? left.cost.totals[0]!.currency : undefined;
  const rightCurrency = right.cost.status === "known" && right.cost.totals.length === 1 ? right.cost.totals[0]!.currency : undefined;
  if (leftCurrency && rightCurrency && leftCurrency !== rightCurrency) return false;
  const leftScenarios = left.robustness?.scenarioStatuses.map(({ scenarioRef }) => scenarioRef).sort().join(",");
  const rightScenarios = right.robustness?.scenarioStatuses.map(({ scenarioRef }) => scenarioRef).sort().join(",");
  if (leftScenarios && rightScenarios && leftScenarios !== rightScenarios || left.robustness && right.robustness && left.robustness.factsVersion !== right.robustness.factsVersion) return false;
  const knownRank = { unknown: 0, partial: 1, known: 2 } as const;
  const costRank = { unknown: 0, "mixed-currency": 0, partial: 1, known: 2 } as const;
  const statusRank = { infeasible: 0, unknown: 1, feasible: 2 } as const;
  const comparableWorkload = left.workload.status === "known" && right.workload.status === "known";
  const comparableCost = left.cost.status === "known" && right.cost.status === "known" && left.cost.totals.length === 1 && right.cost.totals.length === 1;
  const quality = (item: PlanVariantAssessment) => {
    const robustness = item.robustness ? Math.min(statusRank[item.robustness.normalStatus], ...item.robustness.scenarioStatuses.map(({ status }) => statusRank[status])) : statusRank.unknown;
    const costValue = comparableCost ? -item.cost.totals[0]!.amountMinor : 0;
    return [hard[item.hardConstraints.status], -item.unknowns.length,
      -item.softPreferences.reduce((sum, value) => sum + (value.status === "conflicted" ? 2 : value.status === "unknown" ? 1 : 0), 0),
      knownRank[item.workload.status], comparableWorkload ? -(item.workload.travelMinutes ?? 0) : 0,
      costRank[item.cost.status], costValue, item.evidenceCoverage.covered, -(item.evidenceCoverage.total - item.evidenceCoverage.covered),
      -item.changeAmount.changedComponents, -item.changeAmount.protectedChanges, -item.changeAmount.refetches, robustness];
  };
  const a = quality(left), b = quality(right);
  return a.every((value, index) => value >= b[index]!) && a.some((value, index) => value > b[index]!);
}
function novelty(candidate: DiverseCandidate, accepted: readonly DiverseCandidate[]): number {
  if (!accepted.length) return 1;
  const dimensions = [candidate.regionRef, candidate.workloadBand, candidate.budgetBand, ...candidate.styleRefs].filter((value): value is string => Boolean(value));
  if (!dimensions.length) return 0;
  const seen = new Set(accepted.flatMap((item) => [item.regionRef, item.workloadBand, item.budgetBand, ...item.styleRefs].filter((value): value is string => Boolean(value))));
  return dimensions.filter((value) => !seen.has(value)).length / dimensions.length;
}
function stableId(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value)) throw new Error("Invalid stable ID"); }
function validInstant(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
