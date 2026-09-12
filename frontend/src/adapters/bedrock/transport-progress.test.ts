// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { applyTripProposal } from "@raiquora/trip/trip";
import { askProgressFixture, modelTool, modelTools, modelAnswer } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime } from "./viewer-agent-runtime";
import { transportCandidateFixture } from "../../usecases/trip-plan/transport-selection.fixture";
import { resolveAssistantMessage } from "../../presentation/concierge/ai-guide-panel";
import { observeViewerTurn } from "../../usecases/agent/viewer-turn-progress";
import { evaluateTravelProgress } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTurnObservation } from "../../usecases/agent/agent-turn-outcome";
import type { AgentTrace } from "../../usecases/agent/agent-trace";

const manual = { itemId: "taxi", operation: "add", title: "空港への移動", mode: "taxi", origin: "ホテル", destination: "空港", schedule: { type: "unscheduled" } };
describe("non-rail transport through production Runtime and visible preview", () => {
  it.each(["manual", "provider"])("shows %s endpoints/schedule and question together without writer or hidden TTFI", async (kind) => {
    const f = askProgressFixture("C-candidate"), record = transportCandidateFixture(f.trip.id);
    let calls = 0, observed: AgentTurnObservation | undefined;
    const response = await runViewerAgentRuntime("移動を追加して", { ...f.base,
      transportSelection: { taskId: "task-a", port: { resolve: async () => [record] } }, onTurnObservation: (o) => { observed = o; },
    }, async () => calls++ === 0 ? modelTools(
      kind === "manual" ? modelTool("propose_manual_transport", manual) : modelTool("propose_transport_selection", { itemId: "taxi", operation: "add", candidateId: "transport-a" }),
      modelTool("ask_follow_up", { question: "荷物は多いですか", expectedInput: "free-text" }, "question"),
    ) : modelAnswer("移動予定を提案します。"));
    expect(observed?.outcome).toBe("ask_and_progress"); expect(observed?.progress).toContainEqual({ kind: "itinerary", refs: ["taxi"] });
    const li = document.createElement("li"); li.scrollIntoView = vi.fn(); const writer = vi.fn();
    resolveAssistantMessage(li, response, undefined, writer, undefined, undefined, undefined, undefined, false);
    for (const s of kind === "manual" ? ["タクシー", "ホテル → 空港", "時間未定", "荷物"] : ["飛行機", "羽田空港 → 新千歳空港", "9/22", "08:00", "荷物"]) expect(li.textContent).toContain(s);
    expect(writer).not.toHaveBeenCalled(); expect(li.querySelector(".trip-plan-update-apply")).toBeNull();
    expect(evaluateTravelProgress("hidden", [{ observation: observed, delivered: false }], { ttfi: 1, selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 1 }).ttfi).toBeNull();
  });
  it("preserves unscheduled air, assumptions and mode/places/provenance in model context", async () => {
    const f = askProgressFixture("C-candidate"); let calls = 0;
    const response = await runViewerAgentRuntime("便は未定ですが東京から札幌へ飛行機で行く", f.base, async () => {
      if (calls++ === 0) return modelTools(modelTool("propose_manual_transport", { ...manual, mode: "air", origin: "東京", destination: "札幌" }));
      if (calls === 2) return modelTools(modelTool("propose_request_assumptions", { request: { ...f.trip.request, assumptions: [
        { id: "flight", text: "便と時刻は未確定の仮案", status: "unconfirmed", source: "model", affects: [{ type: "item", itemId: "taxi", field: "selection" }] },
      ] } }));
      return modelAnswer("便の未確定な移動案です。");
    });
    if (typeof response === "string" || !("tripUpdateProposal" in response)) throw new Error("Missing proposal");
    const preview = applyTripProposal(f.trip, response.tripUpdateProposal);
    expect(response.text).toContain("⚠ 仮置き"); expect(f.trip.items.some((i) => i.id === "taxi")).toBe(false);
    let context = "";
    await runViewerAgentRuntime("今の予定を確認", { ...f.base, getCurrentTrip: () => preview }, async (messages) => { context = JSON.stringify(messages[0]); return modelAnswer("予定を確認しました。"); });
    for (const s of ["air", "東京", "札幌", "unscheduled", "manual", "selected", "unconfirmed"]) expect(context).toContain(s);
  });
  it("does not count internal success if the run fails before delivering a preview", async () => {
    const f = askProgressFixture("C-candidate"); let trace: AgentTrace | undefined;
    const response = await runViewerAgentRuntime("タクシーを追加", { ...f.base, storeAgentTrace: async (t) => { trace = t; } }, async () => modelTools(modelTool("propose_manual_transport", manual)));
    expect(trace?.events.some((e) => e.type === "tool_completed" && e.toolName === "propose_manual_transport" && e.outcome === "success")).toBe(true);
    expect(observeViewerTurn(response, []).progress).toEqual([]);
  });
  it("rejects model provider identity/retention and keeps capabilities independent of state", async () => {
    const f = askProgressFixture("C-candidate"), sets: string[][] = [];
    for (const planningState of ["inspiration", "candidate_selection", "itinerary_refinement"] as const) {
      let calls = 0;
      const response = await runViewerAgentRuntime("移動を追加", { ...f.base, getCurrentTrip: () => ({ ...f.trip, planningState }) }, async (_m, descriptors) => {
        if (calls++ === 0) { sets.push(descriptors!.map((d) => d.name)); return modelTools(modelTool("propose_manual_transport", { ...manual, providerItemId: "fake", retention: true })); }
        return modelAnswer("確認できませんでした。");
      });
      expect(observeViewerTurn(response, []).progress).toEqual([]);
    }
    expect(sets[0]).toContain("propose_manual_transport"); expect(sets[0]).toEqual(sets[1]); expect(sets[1]).toEqual(sets[2]);
  });
});
