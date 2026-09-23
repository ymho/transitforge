import { describe, expect, it } from "vitest";
import { bindPublicPlanTarget, parsePublicPlanPresentation, withMeasuredResearchOutcome } from "./public-plan-presentation";

function presentation(days = 30) {
  const candidateDays = Array.from({ length: days }, (_, index) => ({ dayRef: `day-${index + 1}`, label: `${index + 1}日目`, status: "planned" as const,
    entries: [{ entryRef: `entry-${index + 1}`, itemRef: `item-${index + 1}`, role: "visit" as const }] }));
  const items = candidateDays.map((_day, index) => ({ itemRef: `item-${index + 1}`, sourceRef: `source-${index + 1}`, title: `予定${index + 1}`,
    kind: "activity" as const, timing: "day" as const, evidenceRefs: ["evidence-1"], photoRefs: ["photo-1"] }));
  return { version: "public-plan-presentation-v1" as const, presentationId: "presentation-1",
    candidateSetRef: { kind: "candidate-set-ref" as const, candidateSetId: "set-1", revision: 1 }, candidateOrder: ["variant-1"],
    candidates: [{ variantId: "variant-1", label: "30日案", dayOrder: candidateDays.map(({ dayRef }) => dayRef), days: candidateDays, items,
      unknowns: [], workload: { status: "known" as const, travelMinutes: 400 }, cost: { status: "partial" as const, currency: "JPY", amountMinor: 100_000 }, comparisonAssessmentRefs: ["compare-1"], scenarioRefs: ["rain-1"] }],
    evidenceRefs: ["evidence-1"], photoRefs: ["photo-1"], coverage: { status: "complete" as const, coveredDayRefs: candidateDays.map(({ dayRef }) => dayRef), omittedDayRefs: [], omittedScopes: [] },
    statements: [{ kind: "fact" as const, ref: "fact-1", evidenceRefs: ["evidence-1"] }], comparisonAssessmentRefs: ["compare-1"], scenarioRefs: ["rain-1"],
    researchOutcome: { status: "complete" as const, requestedMode: "standard" as const, effectiveMode: "standard" as const,
      budget: { modelCalls: 999, toolCalls: 999, wallClockMs: 999 }, coveredScopes: ["all"], remainingScopes: [] } };
}

describe("PublicPlanPresentation", () => {
  it("retains a bounded 30-day plan and binds its real candidate revision to the Trip revision", () => {
    const parsed = bindPublicPlanTarget(parsePublicPlanPresentation(presentation()), { tripId: "11111111-1111-4111-8111-111111111111", baseTripRevision: 7 });
    expect(parsed.candidates[0]!.days).toHaveLength(30); expect(parsed.target).toEqual({ tripId: "11111111-1111-4111-8111-111111111111", baseTripRevision: 7 });
    expect(parsed.candidateSetRef).toMatchObject({ kind: "candidate-set-ref", candidateSetId: "set-1", revision: 1, baseTripRevision: 7 });
    expect(Buffer.byteLength(JSON.stringify(parsed))).toBeLessThan(180_000);
  });
  it("uses runtime measurements, does not mutate input/photo arrays and forbids unrequested detailed mode", () => {
    const input = presentation(7), before = structuredClone(input);
    const parsed = withMeasuredResearchOutcome(parsePublicPlanPresentation(input), { modelCalls: 2, toolCalls: 3, wallClockMs: 450, requestedMode: "standard", effectiveMode: "standard" });
    expect(parsed.researchOutcome.budget).toEqual({ modelCalls: 2, toolCalls: 3, wallClockMs: 450 }); expect(input).toEqual(before);
    (input.candidates[0]!.items[0]!.photoRefs as string[]).push("foreign"); expect(parsed.candidates[0]!.items[0]!.photoRefs).toEqual(["photo-1"]);
    expect(() => withMeasuredResearchOutcome(parsed, { modelCalls: 2, toolCalls: 3, wallClockMs: 450, requestedMode: "standard", effectiveMode: "detailed" })).toThrow("exceeds");
  });
  it("rejects fake/unpublished refs, revision mismatch and silent complete coverage omissions", () => {
    expect(() => parsePublicPlanPresentation({ ...presentation(1), candidateOrder: ["fake"] })).toThrow();
    expect(() => parsePublicPlanPresentation({ ...presentation(1), photoRefs: [] })).toThrow("unbound");
    expect(() => parsePublicPlanPresentation({ ...presentation(1), target: { tripId: "trip", baseTripRevision: 4 }, candidateSetRef: { kind: "candidate-set-ref", candidateSetId: "set-1", revision: 1, baseTripRevision: 3 } })).toThrow("revisions differ");
    const partial = { ...presentation(2), coverage: { status: "complete" as const, coveredDayRefs: ["day-1"], omittedDayRefs: ["day-2"], omittedScopes: [] as string[] } };
    expect(() => parsePublicPlanPresentation(partial)).toThrow("Complete presentation");
  });
});
