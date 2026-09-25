// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { renderPublicPlanPresentation } from "./public-plan-presentation-view";

const candidate = (id: string, days = 1) => ({ variantId: id, label: `案${id}`, dayOrder: Array.from({ length: days }, (_, i) => `${id}-day-${i}`),
  days: Array.from({ length: days }, (_, i) => ({ dayRef: `${id}-day-${i}`, label: `${i + 1}日目`, status: "planned" as const,
    entries: [{ entryRef: `${id}-entry-${i}`, itemRef: `${id}-item-${i}`, role: "visit" as const }] })),
  items: Array.from({ length: days }, (_, i) => ({ itemRef: `${id}-item-${i}`, sourceRef: `${id}-source-${i}`, title: `予定${i + 1}`, kind: "activity" as const, timing: "day" as const, evidenceRefs: [], photoRefs: [] })),
  unknowns: ["営業時間"], workload: { status: "partial" as const }, cost: id === "a" ? { status: "known" as const, currency: "EUR", amountMinor: 1234 } : { status: "unknown" as const }, comparisonAssessmentRefs: [], scenarioRefs: ["rain"] });
function value(days = 1) { const candidates = [candidate("a", days), candidate("b", days)]; return parsePublicPlanPresentation({ version: "public-plan-presentation-v1", presentationId: "presentation-1",
  target: { tripId: "11111111-1111-4111-8111-111111111111", baseTripRevision: 2 }, candidateSetRef: { kind: "candidate-set-ref", candidateSetId: "set-1", revision: 3, baseTripRevision: 2 },
  candidateOrder: ["a", "b"], candidates, evidenceRefs: [], photoRefs: [], coverage: { status: "complete", coveredDayRefs: candidates.flatMap((c) => c.dayOrder), omittedDayRefs: [], omittedScopes: [] },
  statements: [], comparisonAssessmentRefs: [], scenarioRefs: ["rain"], researchOutcome: { status: "complete", requestedMode: "standard", effectiveMode: "standard", budget: { modelCalls: 2, toolCalls: 3, wallClockMs: 100 }, coveredScopes: ["days"], remainingScopes: [] } }); }

describe("public plan presentation view", () => {
  it("supports keyboard tabs and emits typed detailed/adoption targets", () => {
    const root = renderPublicPlanPresentation(value()), detailed = vi.fn(), adoption = vi.fn(); root.addEventListener("raiquora:detailed-research", detailed); root.addEventListener("raiquora:preview-plan-adoption", adoption);
    expect(root.textContent).toContain("€12.34"); expect(root.textContent).not.toContain("写真未取得");
    expect(root.textContent).not.toContain("モデル2回");
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')]; tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    root.querySelector<HTMLButtonElement>(".public-plan-adopt")!.click(); expect(adoption.mock.calls[0]![0].detail).toMatchObject({ candidateSetId: "set-1", variantId: "a", baseTripRevision: 2 });
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "さらに詳しく比較する")!.click();
    expect(detailed.mock.calls[0]![0].detail).toMatchObject({ presentationId: "presentation-1", candidateSetRevision: 3, tripId: "11111111-1111-4111-8111-111111111111" });
  });
  it("renders all 30 days without clipping", () => { const root = renderPublicPlanPresentation(value(30)); expect(root.querySelectorAll(".public-plan-days > li")).toHaveLength(60); });
  it("shows a single unsaved draft as one itinerary without misleading actions or internal metrics", () => {
    const draft = value();
    const root = renderPublicPlanPresentation(parsePublicPlanPresentation({ ...draft, candidates: [draft.candidates[0]], candidateOrder: ["a"],
      target: undefined, candidateSetRef: { kind: "unavailable", reason: "legacy-projection" },
      coverage: { status: "partial", coveredDayRefs: ["a-day-0"], omittedDayRefs: [], omittedScopes: ["出発地"] },
      researchOutcome: { ...draft.researchOutcome, status: "partial", budget: { modelCalls: 0, toolCalls: 0, wallClockMs: 0 } } }));
    expect(root.querySelectorAll(".public-plan-days li li")).toHaveLength(1);
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.textContent).toContain("予定1");
    for (const phrase of ["モデル0回", "Tool0回", "2/2予定", "写真未取得", "採用できません", "さらに詳しく比較する"])
      expect(root.textContent).not.toContain(phrase);
  });
});
