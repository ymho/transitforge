import { describe, it, expect } from "vitest";
import { applyTripProposal } from "@raiquora/trip/trip";
import { assumedRequest } from "../../../../modules/trip/domain/trip-request.fixture";
import { proposeAssumptionDecision } from "../../usecases/trip-plan/update-trip-request";
import { planAssumptionViews } from "../../presentation/trip-plan/plan-assumption-view";
import { progressCaseIds, runAskProgressCase, askProgressFixture, modelTools, modelTool, modelAnswer, progressQuestion, progressPage, progressQuote } from "./ask-progress-scenarios.fixture";
import { runViewerAgentRuntime } from "./viewer-agent-runtime";
import type { AgentTurnObservation } from "@raiquora/agent/agent-turn-outcome";

describe("Ask + Progress production pipeline", () => {
  it.each(progressCaseIds)("evaluates acceptance %s with actual runtime and Domain boundaries", async (id) => {
    const result = await runAskProgressCase(id);
    expect(result.failures).toEqual([]);
    expect(result.trace?.events.some((e) => e.type === "turn_observed" && e.accepted)).toBe(true);
    if (id === "A-vague" || id === "B-known-region" || id === "D-known-request" || id === "F-hard-unknown" || id === "G-consecutive") {
      expect(result.observation?.outcome).toBe("ask_and_progress");
      expect(typeof result.response !== "string" && result.response.text).toContain("[情報源1](https://example.com/nature)");
    }
    if (id === "D-known-request") expect(JSON.stringify(result.trace)).toContain("既知の出発地は聞き直せません");
    if (id === "G-consecutive") expect(result.trace?.events.some((e) => e.type === "turn_observed" && !e.accepted)).toBe(true);
    if (id === "E-past") {
      expect(result.contexts[0]).toContain('"position":"past"');
      expect(result.contexts[0]).toContain('"earliest":"2025-09-22"');
      expect(result.trip.lifecycleState).toBe("pre_trip");
    }
    if (id === "F-hard-unknown") {
      const context = JSON.parse(result.contexts[0]!.match(/<agent_context>([\s\S]*)<\/agent_context>/u)![1]!);
      expect(context.tripFeasibility.issues).toContainEqual(expect.objectContaining({
        code: "hard_constraint_unknown", status: "unknown", constraintIds: ["return-deadline"],
      }));
    }
    if (id === "C-candidate") {
      if (typeof result.response === "string" || !("tripUpdateProposal" in result.response)) throw new Error("missing V2 proposal");
      const preview = applyTripProposal(result.trip, result.response.tripUpdateProposal);
      expect(preview.planningState).toBe("itinerary_draft");
      expect(preview.items[1]?.schedule.type).toBe("unscheduled");
      expect(JSON.stringify(preview)).not.toMatch(/delayMinutes|delayStatus|journeys|options/);
      expect(result.trip.planningState).toBe("candidate_selection");
    }
  });

  it("known origin/date precedence uses Request rather than legacy or history extraction", async () => {
    const f = askProgressFixture("B-known-region"); let context = ""; let calls = 0;
    await runViewerAgentRuntime("候補を探して", { ...f.base,
      getTripContext: () => ({ startDate: "2020-01-01", destinationWish: "別の旅" }),
      getConversationContext: () => ({ messages: [{ role: "user", text: "以前は大阪発でした" }] }),
    }, async (messages) => {
      context = JSON.stringify(messages[0]);
      return calls++ === 0 ? modelTools(modelTool("ask_follow_up", { question: "日程は？", expectedInput: "departure-date" })) : modelAnswer("保存済みの日程で調べます。");
    });
    expect(calls).toBe(2);
    expect(context).toContain("persistedTripRequest");
    expect(context).toContain("京都");
    expect(context).not.toContain("2020-01-01");
  });

  it.each(["safety", "hard_constraint_unknown", "tool_input_missing"] as const)("records the structured %s exception", async (reason) => {
    const f = askProgressFixture("F-hard-unknown"); let observation: AgentTurnObservation | undefined;
    let calls = 0;
    const response = await runViewerAgentRuntime("必要な確認をして", { ...f.base, previousAssistantTurn: "ask_only",
      onTurnObservation: (o) => { observation = o; },
    }, async () => reason === "tool_input_missing" && calls++ === 0
      ? modelTools(modelTool("search_web", {}))
      : modelTools(modelTool("ask_follow_up", { ...progressQuestion,
      askOnlyException: { reason, missingFact: "利用者にしか確認できない安全条件",
        ...(reason === "hard_constraint_unknown" ? { constraintId: "return-deadline" } : {}),
        ...(reason === "tool_input_missing" ? { toolName: "search_web", inputName: "query" } : {}),
      },
    })));
    expect(typeof response).not.toBe("string");
    expect(observation).toMatchObject({ outcome: "ask_only", exception: { reason } });
  });

  it("displays existing unconfirmed assumptions, with confirmation/rejection via #387 only", async () => {
    const f = askProgressFixture("B-known-region"); const request = assumedRequest(); let calls = 0;
    const response = await runViewerAgentRuntime("ゆっくり巡る仮案で", f.base, async () => calls++ === 0
      ? modelTools(modelTool("propose_request_assumptions", { request: { ...f.trip.request,
        constraints: [...f.trip.request.constraints, ...request.constraints], assumptions: request.assumptions } }))
      : modelAnswer("ゆっくり巡る前提は仮置きです。"));
    if (typeof response === "string" || !("tripUpdateProposal" in response)) throw new Error("missing proposal");
    expect(response.text).toContain("⚠ 仮置き");
    const preview = applyTripProposal(f.trip, response.tripUpdateProposal);
    expect(preview.request.assumptions[0]?.status).toBe("unconfirmed");
    expect(f.trip.request.assumptions).toEqual([]);
    const actions = planAssumptionViews(preview)[0]!.actions;
    expect(actions.map((a) => a.status)).toEqual(["confirmed", "rejected"]);
    const rejected = applyTripProposal(preview, proposeAssumptionDecision(preview, "assumption", "rejected"));
    let context = "";
    await runViewerAgentRuntime("別の案で", { ...f.base, getCurrentTrip: () => rejected }, async (messages) => {
      context = JSON.stringify(messages[0]); return modelAnswer("却下した仮定は使いません。");
    });
    expect(context).toContain("rejected");
    expect(context).toContain('unconfirmedAssumptions\\\":[]');
  });

  it("does not dispatch tools by planning/lifecycle state", async () => {
    const discovery = await runAskProgressCase("B-known-region");
    const f = askProgressFixture("B-known-region"); let tools: string[] = [];
    await runViewerAgentRuntime("条件を確認", { ...f.base, getCurrentTrip: () => ({ ...f.trip, planningState: "candidate_selection" }) }, async (_m, descriptors) => {
      tools = descriptors!.map((d) => d.name); return modelAnswer("確認します。");
    });
    expect(tools).toEqual(discovery.toolsByCall[0]);
  });

  it.each(["unread", "fabricated-quote", "missing-evidence"])("does not publish %s as grounded progress", async (kind) => {
    const f = askProgressFixture("A-vague"); let calls = 0; let observation: AgentTurnObservation | undefined;
    const response = await runViewerAgentRuntime("候補を調べて", { ...f.base,
      ...(kind === "missing-evidence" ? { readWebPages: async () => ({ webPages: { status: "available" as const, freshness: "fresh" as const, evidence: [], data: { pages: [progressPage] } } }) } : {}),
      onTurnObservation: (o) => { observation = o; },
    }, async () => {
      const step = calls++;
      if (step === 0 && kind !== "unread") return modelTools(modelTool("read_web_pages", { urls: [progressPage.url] }));
      if (step === (kind === "unread" ? 0 : 1)) return modelTools(modelTool("present_travel_progress", {
        summary: "これは公開してはいけない推薦", findings: [{ sourceUrl: progressPage.url, quote: kind === "fabricated-quote" ? "存在しない観光施設の紹介です。" : progressQuote }],
      }));
      return modelTools(modelTool("ask_follow_up", progressQuestion));
    });
    expect(JSON.stringify(response)).not.toContain("これは公開してはいけない");
    expect(observation?.progress).toEqual([]);
  });

  it("rejects fabricated candidate identifiers and unobserved missing-input exceptions", async () => {
    const f = askProgressFixture("C-candidate"); let calls = 0;
    const response = await runViewerAgentRuntime("候補を採用", { ...f.base, previousAssistantTurn: "ask_only" }, async () => {
      if (calls++ === 0) return modelTools(modelTool("propose_candidate_selection", { candidateId: "not-issued", itemId: "outbound" }));
      if (calls === 2) return modelTools(modelTool("ask_follow_up", { ...progressQuestion,
        askOnlyException: { reason: "tool_input_missing", missingFact: "検索語", toolName: "search_web", inputName: "query" } }));
      return modelAnswer("選択する候補を確認できませんでした。");
    });
    expect(calls).toBe(3); expect(JSON.stringify(response)).not.toContain("tripUpdateProposal");
    expect(f.trip.planningState).toBe("candidate_selection");
  });
});
