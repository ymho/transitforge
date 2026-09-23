import { describe, expect, it } from "vitest";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import type { ItineraryCandidateSet } from "@raiquora/trip/itinerary-candidates";
import type { ItineraryCandidateRepository } from "../ports/itinerary-candidate-repository.js";
import { PlanCandidateRetentionApplication, registerPlanCandidateRetentionTool } from "./plan-candidate-retention.js";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";

const principal = { subject: "owner-a" }, tripId = "11111111-1111-4111-8111-111111111111";
const draft = { coverage: { coveredScopes: ["day-1"], omittedScopes: [], complete: true }, variants: [{ id: "variant-1", label: "案1",
  timeline: { dayOrder: ["day-1"], itemOrder: ["component-1"] }, items: [{ componentId: "component-1", kind: "activity" as const, title: "散策", schedule: { type: "unscheduled" as const }, evidenceRefs: ["evidence-1"], placement: { atBeginning: true as const } }],
  assumptionRefs: [], assessmentRefs: [], changedComponentIds: ["component-1"], removedBaseItemIds: [], retainedBaseItemIds: [] }] };
function presentation() { return parsePublicPlanPresentation({ version: "public-plan-presentation-v1", presentationId: "presentation-1", candidateSetRef: { kind: "unavailable", reason: "not-retained" },
  candidateOrder: ["variant-1"], candidates: [{ variantId: "variant-1", label: "案1", dayOrder: ["day-1"], days: [{ dayRef: "day-1", label: "1日目", status: "planned", entries: [{ entryRef: "entry-1", itemRef: "item-1", role: "visit" }] }],
    items: [{ itemRef: "item-1", sourceRef: "component-1", title: "散策", kind: "activity", timing: "unscheduled", evidenceRefs: ["evidence-1"], photoRefs: [] }], unknowns: [], comparisonAssessmentRefs: [], scenarioRefs: [] }],
  evidenceRefs: ["evidence-1"], photoRefs: [], coverage: { status: "complete", coveredDayRefs: ["day-1"], omittedDayRefs: [], omittedScopes: [] }, statements: [{ kind: "proposal", ref: "component-1", evidenceRefs: ["evidence-1"] }], comparisonAssessmentRefs: [], scenarioRefs: [],
  researchOutcome: { status: "complete", requestedMode: "standard", effectiveMode: "standard", budget: { modelCalls: 1, toolCalls: 1, wallClockMs: 10 }, coveredScopes: ["day-1"], remainingScopes: [] } }); }

describe("canonical candidate retention", () => {
  it("issues the real set ID/context server-side, persists owner+conversation scope and publishes the exact ref", async () => {
    let saved: ItineraryCandidateSet | undefined;
    const repository: ItineraryCandidateRepository = { put: async (owner, value) => { expect(owner).toEqual(principal); saved = structuredClone(value); }, get: async () => saved };
    const app = new PlanCandidateRetentionApplication(repository, () => new Date("2026-09-23T12:00:00Z"));
    const result = await app.retain({ principal, executionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", conversationId: "conversation-1", userRequest: "3日間の案を作って", tripId, baseTripRevision: 4 }, draft, presentation());
    expect(saved).toMatchObject({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision: 0, contextRef: { conversationId: "conversation-1", tripId, baseTripRevision: 4 }, expiresAt: "2026-09-24T12:00:00.000Z" });
    expect(saved!.contextRef.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.presentation).toMatchObject({ target: { tripId, baseTripRevision: 4 }, candidateSetRef: { kind: "candidate-set-ref", candidateSetId: saved!.id, revision: 0, baseTripRevision: 4 } });
  });
  it("rejects a presentation that invents a retained ID or does not exactly match variant order", async () => {
    const repository: ItineraryCandidateRepository = { put: async () => { throw new Error("must not write"); }, get: async () => undefined };
    const app = new PlanCandidateRetentionApplication(repository, () => new Date("2026-09-23T12:00:00Z"));
    const scope = { principal, executionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", conversationId: "conversation-1", userRequest: "旅程", tripId, baseTripRevision: 4 };
    await expect(app.retain(scope, draft, parsePublicPlanPresentation({ ...presentation(), candidateSetRef: { kind: "candidate-set-ref", candidateSetId: "fake", revision: 0 } }))).rejects.toMatchObject({ code: "invalid-input" });
  });
  it("runs through the production Tool registry and publishes only the actually persisted ref", async () => {
    let saved: ItineraryCandidateSet | undefined, published: ReturnType<typeof presentation> | undefined;
    const repository: ItineraryCandidateRepository = { put: async (_owner, value) => { saved = structuredClone(value); }, get: async () => saved };
    const tools = new AgentToolRegistry(); const scope = { principal, executionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", conversationId: "conversation-1", userRequest: "旅程", tripId, baseTripRevision: 4 };
    registerPlanCandidateRetentionTool(tools, new PlanCandidateRetentionApplication(repository, () => new Date("2026-09-23T12:00:00Z")), scope,
      (value) => { published = value.presentation; });
    const safeDraft = { ...draft, variants: draft.variants.map((variant) => ({ ...variant, items: variant.items.map((item) => ({ ...item, evidenceRefs: [] })) })) };
    const result = await tools.execute("propose_itinerary_candidate_set", { draft: safeDraft, presentation: { ...presentation(), evidenceRefs: [],
      statements: [], candidates: presentation().candidates.map((candidate) => ({ ...candidate, items: candidate.items.map((item) => ({ ...item, evidenceRefs: [] })) })) } }, { executionId: scope.executionId });
    expect(result).toMatchObject({ ok: true, output: { candidateSetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision: 0, saved: false, confirmationRequired: true } });
    expect(published?.candidateSetRef).toMatchObject({ kind: "candidate-set-ref", candidateSetId: saved!.id });
  });
});
