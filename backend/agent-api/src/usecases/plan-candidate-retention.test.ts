import { describe, expect, it, vi } from "vitest";
import type { ItineraryCandidateSet } from "@raiquora/trip/itinerary-candidates";
import type { ItineraryCandidateRepository } from "../ports/itinerary-candidate-repository.js";
import { PlanCandidateRetentionApplication, registerPlanCandidateRetentionTool, type CanonicalPlanCandidateDraft } from "./plan-candidate-retention.js";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";

const scope = { principal: { subject: "owner-a" }, tripId: "11111111-1111-4111-8111-111111111111",
  executionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", conversationId: "conversation-1", userRequest: "明日から1泊の案", baseTripRevision: 4 };
export function itineraryDraft(): CanonicalPlanCandidateDraft {
  return { coverage: { coveredScopes: ["day-1", "day-2"], omittedScopes: ["宿泊施設と移動時刻"], complete: false }, variants: [{ id: "variant-1", label: "1泊の案",
    timeline: { dayOrder: ["day-1", "day-2"], itemOrder: ["visit", "stay", "return"] },
    items: [{ componentId: "visit", kind: "activity", title: "出雲大社の参拝", schedule: { type: "relative", dayId: "day-1" }, evidenceRefs: [], placement: { atBeginning: true } },
      { componentId: "stay", kind: "stay", title: "宿泊先は未選択", schedule: { type: "relative", dayId: "day-1", endDayId: "day-2" }, evidenceRefs: [], placement: { afterRef: "visit" } },
      { componentId: "return", kind: "transport", title: "帰路は未選択", schedule: { type: "relative", dayId: "day-2" }, evidenceRefs: [], placement: { afterRef: "stay" } }],
    assumptionRefs: [], assessmentRefs: [], changedComponentIds: ["visit", "stay", "return"], removedBaseItemIds: [], retainedBaseItemIds: [] }] };
}
function fixture() {
  let saved: ItineraryCandidateSet | undefined;
  const repository: ItineraryCandidateRepository = { put: vi.fn(async (owner, value) => { expect(owner).toEqual(scope.principal); saved = structuredClone(value); }), get: async () => saved };
  const app = new PlanCandidateRetentionApplication(repository, () => new Date("2026-10-03T00:00:00Z"));
  const tools = new AgentToolRegistry(), publish = vi.fn();
  registerPlanCandidateRetentionTool(tools, app, scope, publish);
  return { repository, app, tools, publish, saved: () => saved };
}
describe("canonical candidate retention and deterministic presentation", () => {
  it("builds the two-day cards from the exact retained items without a second model-authored presentation", async () => {
    const f = fixture(), draft = itineraryDraft();
    const result = await f.tools.execute("draft_itinerary", { draft, unknowns: ["宿と移動時刻は未確認"] }, { executionId: scope.executionId });
    expect(result).toMatchObject({ ok: true, output: { candidateSetId: scope.executionId, revision: 0, saved: false, confirmationRequired: true } });
    expect(f.saved()).toMatchObject({ variants: draft.variants, contextRef: { tripId: scope.tripId, baseTripRevision: 4 }, expiresAt: "2026-10-04T00:00:00.000Z" });
    const publicPlan = f.publish.mock.calls[0]![0].presentation;
    expect(publicPlan.target).toEqual({ tripId: scope.tripId, baseTripRevision: 4 });
    expect(publicPlan.candidates[0].items.map((item: { title: string }) => item.title)).toEqual(draft.variants[0]!.items.map(item => item.title));
    expect(publicPlan.candidates[0].days.map((day: { entries: { itemRef: string }[] }) => day.entries.map(entry => entry.itemRef))).toEqual([["visit", "stay"], ["stay", "return"]]);
    expect(publicPlan.candidates[0].items.filter((item: { kind: string }) => item.kind === "stay")).toHaveLength(1);
    expect(publicPlan.candidates[0].unknowns).toEqual(["宿と移動時刻は未確認"]);
    expect(publicPlan.coverage.status).toBe("partial");
    expect(f.saved()!.contextRef.requestFingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });
  it("rejects model-authored display payloads rather than allowing displayed and retained titles to diverge", async () => {
    const f = fixture();
    expect(await f.tools.execute("draft_itinerary", { draft: itineraryDraft(), unknowns: [], presentation: { title: "別の場所" } }, { executionId: scope.executionId }))
      .toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(f.repository.put).not.toHaveBeenCalled();
  });
  it.each(["duplicate-order", "missing-day", "reverse-span", "evidence", "invalid-unknowns"])("rejects %s before persistence", async kind => {
    const f = fixture(), draft = structuredClone(itineraryDraft()), variant = draft.variants[0]!;
    const bad = kind === "duplicate-order" ? { ...variant, timeline: { ...variant.timeline, itemOrder: ["visit", "visit", "return"] } } :
      kind === "missing-day" ? { ...variant, timeline: { ...variant.timeline, dayOrder: ["day-1"] } } :
      kind === "reverse-span" ? { ...variant, timeline: { ...variant.timeline, dayOrder: ["day-2", "day-1"] } } :
      kind === "evidence" ? { ...variant, items: variant.items.map(item => ({ ...item, evidenceRefs: ["invented"] })) } : variant;
    await expect(f.app.retain(scope, { ...draft, variants: [bad] }, kind === "invalid-unknowns" ? ["x", "x"] : [])).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.repository.put).not.toHaveBeenCalled();
  });
  it("keeps unscheduled items visible without assigning an invented travel date", async () => {
    const f = fixture(), draft = itineraryDraft(), variant = draft.variants[0]!;
    const result = await f.app.retain(scope, { ...draft, variants: [{ ...variant,
      items: variant.items.map(item => ({ ...item, schedule: { type: "unscheduled" } })) }] }, ["日程未定"]);
    const candidate = result.presentation.candidates[0]!;
    expect(candidate.days.at(-1)).toMatchObject({ label: "日程未定", entries: [{ itemRef: "visit" }, { itemRef: "stay" }, { itemRef: "return" }] });
    expect(candidate.days.slice(0, 2).every(day => day.status === "not-retrieved")).toBe(true);
  });
  it("does not publish a card when the candidate repository fails", async () => {
    const f = fixture(); vi.mocked(f.repository.put).mockRejectedValueOnce(new Error("private repository detail"));
    expect(await f.tools.execute("draft_itinerary", { draft: itineraryDraft(), unknowns: [] }, { executionId: scope.executionId }))
      .toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(f.publish).not.toHaveBeenCalled();
  });
});
