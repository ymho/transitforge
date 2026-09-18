// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { applyTripProposal } from "@raiquora/trip/trip";
import { askProgressFixture, modelTool, modelTools, modelAnswer } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime } from "./viewer-agent-runtime";
import { accommodationSelectionFixture } from "../../usecases/trip-plan/accommodation-selection.fixture";
import { resolveAssistantMessage } from "../../presentation/concierge/ai-guide-panel";
import { observeViewerTurn } from "../../usecases/agent/viewer-turn-progress";
import { evaluateTravelProgress } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { registerTripProgressTools, type TripProgressOutput } from "../../usecases/agent/trip-progress-tools";

const choose = { candidateId: "candidate-a", itemId: "stay", accommodation: { provider: "fixture", providerItemId: "hotel-a" } };
function setup() {
  const f = askProgressFixture("C-candidate"), record = accommodationSelectionFixture(f.trip.id);
  const base = { ...f.base, candidateSelection: { taskId: "task-a", port: { resolve: async () => record, loadTimetables: async () => [] } } };
  return { ...f, base, record };
}
describe("selected accommodation through Runtime and rendered progress", () => {
  it("keeps EUR selection observation separate from JPY candidate observation in Context and delivered preview", async () => {
    const f = setup(); f.record.accommodation!.priceRetention = "permitted";
    const price = { price: { currency: "EUR" as const, amountMinor: 12000 }, observedAt: "2026-09-12T07:55:00Z", basis: "selected-dates" as const };
    f.record.candidate.accommodations[0]!.price = price;
    const response = await runViewerAgentRuntime("このEURの宿にします", f.base, async () => modelTools(modelTool("propose_candidate_selection", choose)));
    if (typeof response === "string" || !("tripUpdateProposal" in response)) throw new Error("Missing preview");
    const li = document.createElement("li"); li.scrollIntoView = vi.fn();
    resolveAssistantMessage(li, response, undefined, undefined, undefined, undefined, undefined, undefined, false);
    expect(li.textContent).toContain("選択時の参考価格: EUR 120.00"); expect(li.textContent).toContain(price.observedAt);
    const preview = applyTripProposal(f.trip, response.tripUpdateProposal); let context = "";
    await runViewerAgentRuntime("比較したい", { ...f.base, getCurrentTrip: () => preview,
      getTravelCandidates: () => [{ candidateId: "other", price: { ...price, price: { currency: "JPY", amountMinor: 20000 } } }] }, async (messages) => {
      context = JSON.stringify(messages[0]); return modelAnswer("原通貨で比較します。");
    });
    for (const text of ["currentTrip", "observedPrice", "retained-selection-observation-not-current-price", "EUR", "12000", "observedAt", "selected-dates", "travelCandidates", "JPY", "20000"]) expect(context).toContain(text);
    expect(f.trip.items[1]).toMatchObject({ selection: { status: "unselected" } });
  });
  it("shows the facility and both dates together with a question, without booking/price claims or writes", async () => {
    const f = setup(); let calls = 0, observation: AgentTurnObservation | undefined;
    const response = await runViewerAgentRuntime("この宿にします", { ...f.base, onTurnObservation: (o) => { observation = o; } }, async () => calls++ === 0 ? modelTools(
      modelTool("propose_candidate_selection", choose), modelTool("ask_follow_up", { question: "現地で食べたいものはありますか", expectedInput: "free-text" }, "question"),
    ) : modelAnswer("宿泊先の案を更新します。"));
    expect(observation?.outcome).toBe("ask_and_progress"); expect(observation?.progress).toContainEqual({ kind: "itinerary", refs: ["stay"] });
    const li = document.createElement("li"); li.scrollIntoView = vi.fn(); const writer = vi.fn();
    resolveAssistantMessage(li, response, undefined, writer, undefined, undefined, undefined, undefined, false);
    for (const text of ["評価用の宿A", "2026-09-22 チェックイン", "2026-09-24 チェックアウト", "食べたいもの"]) expect(li.textContent).toContain(text);
    expect(li.textContent).not.toMatch(/12000|12,000|空室あり|未予約|予約済み/); expect(writer).not.toHaveBeenCalled();
    expect(li.querySelector(".trip-plan-update-apply")).toBeNull();
    const limits = { ttfi: 1, selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 1 };
    expect(evaluateTravelProgress("shown", [{ observation, delivered: true }], limits).ttfi).toBe(1);
    expect(evaluateTravelProgress("hidden", [{ observation, delivered: false }], limits).ttfi).toBeNull();
    if (typeof response === "string" || !("tripUpdateProposal" in response)) throw new Error("Missing preview");
    const preview = applyTripProposal(f.trip, response.tripUpdateProposal); let context = "";
    await runViewerAgentRuntime("今の宿は？", { ...f.base, getCurrentTrip: () => preview }, async (messages) => { context = JSON.stringify(messages[0]); return modelAnswer("採用済みの宿です。"); });
    for (const text of ["評価用の宿A", "selected", "2026-09-22", "2026-09-24", "評価用エリア"]) expect(context).toContain(text);
    expect(context).not.toMatch(/bookingUrl|imageUrl|reviewAverage|availability|12000/);
    expect(f.trip.items[1]).toMatchObject({ selection: { status: "unselected" } });
    // The same delivered add contract counts, without introducing an add-stay model Tool.
    const addResponse = { ...response, tripUpdateProposal: { ...response.tripUpdateProposal,
      patches: [{ type: "add" as const, item: preview.items[1]! }] } };
    expect(observeViewerTurn(addResponse, []).progress).toContainEqual({ kind: "itinerary", refs: ["stay"] });
  });
  it("does not count a successful Tool's private proposal when no preview is delivered", async () => {
    const f = setup(), registry = new AgentToolRegistry(), state: TripProgressOutput = {};
    registerTripProgressTools(registry, f.base, state, () => new Date("2026-09-12T08:00:00Z"), () => []);
    const result = await registry.execute("propose_candidate_selection", choose, { executionId: "not-presented", signal: new AbortController().signal });
    expect(result.ok).toBe(true); expect(state.proposal).toBeDefined();
    // Only delivered artifacts enter the observer; Tool result metadata is deliberately not input.
    const observation = observeViewerTurn("案内を完了できませんでした", []);
    expect(observation.progress).toEqual([]);
    expect(evaluateTravelProgress("internal-only", [{ observation, delivered: true, modelCalls: 1 }],
      { ttfi: 1, selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 1 }).ttfi).toBeNull();
  });
  it("rejects forged Offering/evidence/retention in model input", async () => {
    const f = setup(); let calls = 0;
    const response = await runViewerAgentRuntime("この宿にします", f.base, async () => calls++ === 0 ? modelTools(modelTool("propose_candidate_selection",
      { ...choose, offering: f.record.candidate.accommodations[0], storageAllowed: true, source: f.record.accommodation!.source })) : modelAnswer("確認できませんでした。"));
    expect(observeViewerTurn(response, []).progress).toEqual([]);
  });
});
