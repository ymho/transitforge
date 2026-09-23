import { describe, expect, it } from "vitest";
import { comparePlanVariants, createItineraryCandidateSet, proposePlanAdoption, selectDiverseCandidates, type ItineraryCandidateSet, type PlanVariantAssessment } from "./itinerary-candidates";
import { createTrip } from "./trip";

const assessment = (id: string, overrides: Partial<PlanVariantAssessment> = {}): PlanVariantAssessment => ({ variantId: id,
  hardConstraints: { status: "satisfied", refs: [] }, unknowns: [], softPreferences: [{ ref: "pace", status: "matched" }],
  workload: { status: "known", travelMinutes: 60, sourceRef: "workload-v1" }, cost: { status: "known", totals: [{ currency: "JPY", amountMinor: 10_000 }], sourceRefs: ["cost-v1"] },
  evidenceCoverage: { covered: 4, total: 4, sourceRefs: ["evidence-v1"] }, changeAmount: { changedComponents: 1, protectedChanges: 0, refetches: 0 }, ...overrides });

describe("itinerary candidate comparison", () => {
  it("keeps hard violation, unknown, cost, workload, evidence and change as separate axes", () => {
    const good = assessment("good"); const bad = assessment("bad", { hardConstraints: { status: "violated", refs: ["hard-1"] },
      workload: { status: "unknown" }, cost: { status: "unknown", totals: [], sourceRefs: [] }, unknowns: ["duration"],
      changeAmount: { changedComponents: 2, protectedChanges: 1, refetches: 2 } });
    const result = comparePlanVariants([bad, good]);
    expect(result).toMatchObject({ noOverallScore: true, paretoFront: ["good"] }); expect(result.dominatedBy.bad).toEqual(["good"]);
  });
  it("does not compare raw minor units across currencies", () => {
    const jpy = assessment("jpy", { cost: { status: "known", totals: [{ currency: "JPY", amountMinor: 100_000 }], sourceRefs: [] } });
    const eur = assessment("eur", { cost: { status: "known", totals: [{ currency: "EUR", amountMinor: 10 }], sourceRefs: [] } });
    expect(comparePlanVariants([jpy, eur]).paretoFront).toEqual(["eur", "jpy"]);
  });
  it("uses diversity weight while rejecting duplicate resolved places and hard violations", () => {
    const selected = selectDiverseCandidates([
      { variantId: "a", discoveryRef: "h1", placeIdentity: "place-a", regionRef: "west", styleRefs: ["onsen"], workloadBand: "low", budgetBand: "mid", retrievalRelevance: 1, hardStatus: "satisfied" },
      { variantId: "copy", discoveryRef: "h2", placeIdentity: "place-a", regionRef: "west", styleRefs: ["onsen"], workloadBand: "low", budgetBand: "mid", retrievalRelevance: .99, hardStatus: "satisfied" },
      { variantId: "diverse", discoveryRef: "h3", placeIdentity: "place-b", regionRef: "west", styleRefs: ["nature"], workloadBand: "mid", budgetBand: "low", retrievalRelevance: .8, hardStatus: "unknown" },
      { variantId: "broken", discoveryRef: "h4", placeIdentity: "place-c", regionRef: "west", styleRefs: [], retrievalRelevance: 2, hardStatus: "violated" },
    ], { version: 1, maximum: 2, fixedRegionRef: "west", relevanceWeight: 1, diversityWeight: 2 });
    expect(selected.selectedVariantIds).toEqual(["a", "diverse"]); expect(selected.rejected).toEqual(expect.arrayContaining([{ variantId: "copy", reason: "duplicate-resolved-place" }, { variantId: "broken", reason: "hard-constraint-violated" }]));
  });
  it("creates replace/remove/add adoption patches without duplicating the adopted base", () => {
    const trip = createTrip("11111111-1111-4111-8111-111111111111", "base", "2026-09-01T00:00:00Z", [
      { id: "keep", type: "activity", title: "keep", category: "free-time", schedule: { type: "unscheduled" } },
      { id: "replace", type: "activity", title: "old", category: "sightseeing", schedule: { type: "unscheduled" } },
      { id: "remove", type: "activity", title: "remove", category: "food", schedule: { type: "unscheduled" } },
    ]);
    const set: ItineraryCandidateSet = createItineraryCandidateSet({ id: "set-1", revision: 1, contextRef: { conversationId: "conversation-1", requestFingerprint: "request-1", tripId: trip.id, baseTripRevision: 0 },
      coverage: { coveredScopes: ["all"], omittedScopes: [], complete: true }, issuedAt: "2026-09-02T00:00:00Z", expiresAt: "2026-09-03T00:00:00Z", variants: [{ id: "variant-1", label: "day2", timeline: { dayOrder: ["day-2"], itemOrder: ["replace-component", "new-component"] },
        items: [{ componentId: "replace-component", baseItemId: "replace", kind: "activity", title: "new", schedule: { type: "unscheduled" }, evidenceRefs: [] },
          { componentId: "new-component", kind: "activity", title: "added", schedule: { type: "unscheduled" }, evidenceRefs: [], placement: { afterRef: "replace-component" } }], assumptionRefs: [], assessmentRefs: [],
        changedComponentIds: ["replace-component", "new-component"], removedBaseItemIds: ["remove"], retainedBaseItemIds: ["keep"] }] });
    const result = proposePlanAdoption({ candidateSet: set, variantId: "variant-1", currentTrip: trip, requestFingerprint: "request-1", now: "2026-09-02T12:00:00Z",
      trustedFactory: (draft) => ({ id: draft.baseItemId ?? "added", type: "activity", title: draft.title, category: "sightseeing", schedule: draft.schedule }) });
    expect(result.proposal.patches.map(({ type }) => type)).toEqual(["remove", "replace", "add"]);
    expect(result.componentMap).toEqual([{ componentId: "replace-component", itemId: "replace" }, { componentId: "new-component", itemId: "added" }]);
    expect(() => proposePlanAdoption({ candidateSet: set, variantId: "variant-1", currentTrip: trip, requestFingerprint: "request-1", now: set.expiresAt,
      trustedFactory: (draft) => ({ id: draft.baseItemId ?? "added", type: "activity", title: draft.title, category: "sightseeing", schedule: draft.schedule }) })).toThrow("Stale or foreign");
  });
});
