// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { applyTripProposal } from "@raiquora/trip/trip";
import { askProgressFixture, modelTool, modelTools, modelAnswer } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime } from "./viewer-agent-runtime";
import { activityCandidateFixture } from "../../usecases/trip-plan/activity-selection.fixture";
import { resolveAssistantMessage } from "../../presentation/concierge/ai-guide-panel";
import { observeViewerTurn } from "../../usecases/agent/viewer-turn-progress";
import { evaluateTravelProgress } from "../../usecases/agent/evaluation/travel-progress-evaluation";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";
import type { AgentTrace } from "@raiquora/agent/agent-trace";

const manual = { itemId: "break", operation: "add", title: "カフェ休憩", category: "food", schedule: { type: "day", date: "2026-09-22" } };
describe("Activity through the single production runtime and presenter", () => {
  it("shows category/title/schedule/place and question together, with no legacy writer", async () => {
    const f = askProgressFixture("C-candidate"), record = activityCandidateFixture(f.trip.id);
    let calls = 0, observed: AgentTurnObservation | undefined;
    const response = await runViewerAgentRuntime("この食堂を夕食に追加して", { ...f.base,
      activitySelection: { taskId: "task-a", port: { resolve: async () => [record] } },
      onTurnObservation: (o) => { observed = o; },
    }, async () => calls++ === 0 ? modelTools(
      modelTool("propose_activity_selection", { itemId: "meal", candidateId: "activity-a", operation: "add", schedule: manual.schedule }, "adoption"),
      modelTool("ask_follow_up", { question: "食事の時間に希望はありますか", expectedInput: "free-text" }, "question"),
    ) : modelAnswer("夕食の案です。"));
    expect(observed?.outcome).toBe("ask_and_progress");
    expect(observed?.progress).toContainEqual({ kind: "itinerary", refs: ["meal"] });
    const li = document.createElement("li"); li.scrollIntoView = vi.fn(); const legacyWriter = vi.fn();
    resolveAssistantMessage(li, response, undefined, legacyWriter, undefined, undefined, undefined, undefined, false);
    for (const text of ["評価用の森の食堂", "食事", "9/22", "食事の時間に希望はありますか"]) expect(li.textContent).toContain(text);
    expect(li.querySelector(".trip-plan-update-apply")).toBeNull(); expect(legacyWriter).not.toHaveBeenCalled();
    const observation = observeViewerTurn(response, []);
    const hidden = evaluateTravelProgress("hidden-activity", [{ observation, delivered: false }], { ttfi: 1, selectionToDraft: 1, maximumOrdinaryAskOnlyStreak: 1 });
    expect(hidden.ttfi).toBeNull();
  });
  it("uses the same PlanAssumption and ordered preview for add then replace, without mutation", async () => {
    const f = askProgressFixture("C-candidate"); const before = structuredClone(f.trip); let calls = 0;
    const response = await runViewerAgentRuntime("15時くらいに休憩", f.base, async () => {
      if (calls++ === 0) return modelTools(modelTool("propose_manual_activity", manual));
      if (calls === 2) return modelTools(modelTool("propose_manual_activity", { ...manual, operation: "replace", schedule: {
        type: "fixed", startAt: { at: "2026-09-22T15:00:00+09:00", timeZone: "Asia/Tokyo" },
      } }));
      if (calls === 3) return modelTools(modelTool("propose_request_assumptions", { request: { ...f.trip.request, assumptions: [
        { id: "break-time", text: "カフェ休憩の15時開始は仮置きです", source: "model", status: "unconfirmed", affects: [{ type: "item", itemId: "break", field: "schedule" }] },
      ] } }));
      return modelAnswer("休憩時間の案です。");
    });
    if (typeof response === "string" || !("tripUpdateProposal" in response)) throw new Error("Missing proposal");
    const preview = applyTripProposal(f.trip, response.tripUpdateProposal);
    expect(preview.items.find((i) => i.id === "break")?.schedule.type).toBe("fixed");
    expect(preview.request.assumptions[0]?.status).toBe("unconfirmed");
    expect(response.text).toContain("⚠ 仮置き"); expect(response.text).toContain("15:00");
    expect(f.trip).toEqual(before);
    let context = "";
    await runViewerAgentRuntime("この旅を確認", { ...f.base, getCurrentTrip: () => preview }, async (messages) => {
      context = JSON.stringify(messages[0]); return modelAnswer("現在の計画を確認しました。");
    });
    for (const text of ["activity", "food", "カフェ休憩", "break", "unconfirmed"]) expect(context).toContain(text);
  });
  it("a failed/unpublished run with a successful internal Activity Tool is not TTFI", async () => {
    const f = askProgressFixture("C-candidate"); let trace: AgentTrace | undefined;
    const response = await runViewerAgentRuntime("休憩を追加", { ...f.base, storeAgentTrace: async (v) => { trace = v; } },
      async () => modelTools(modelTool("propose_manual_activity", manual)));
    expect(trace?.events.some((e) => e.type === "tool_completed" && e.toolName === "propose_manual_activity" && e.outcome === "success")).toBe(true);
    expect(observeViewerTurn(response, []).progress).toEqual([]);
  });
  it("does not accept model-supplied retention/Provider identity or route capabilities by state", async () => {
    const f = askProgressFixture("C-candidate"); const toolSets: string[][] = [];
    for (const state of ["inspiration", "candidate_selection", "itinerary_refinement"] as const) {
      let calls = 0;
      const response = await runViewerAgentRuntime("休憩", { ...f.base, getCurrentTrip: () => ({ ...f.trip, planningState: state }) }, async (_m, descriptors) => {
        if (calls++ === 0) { toolSets.push(descriptors!.map((d) => d.name)); return modelTools(modelTool("propose_manual_activity", { ...manual, retention: { storage: "permitted" }, provider: "mapbox" })); }
        return modelAnswer("確認できませんでした。");
      });
      expect(observeViewerTurn(response, []).progress).toEqual([]);
    }
    expect(toolSets[0]).toContain("propose_manual_activity");
    expect(toolSets[0]).toEqual(toolSets[1]); expect(toolSets[1]).toEqual(toolSets[2]);
  });
});
