import { describe, expect, it, vi } from "vitest";
import { supportedAnswerClaims } from "@raiquora/agent/grounded-answer";

import { MultiStepAgentRuntime } from "@raiquora/agent/agent-runtime";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type {
  AgentModelProvider,
  AgentModelRequest,
  AgentModelResponse,
} from "@raiquora/agent/model-provider";
import {
  invalidAgentToolInput,
  failedAgentToolResult,
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentTool,
} from "@raiquora/agent/tool-contract";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { inTripFixture } from "../../trip/domain/in-trip-context.fixture";
import { inTripApplicationEvidence } from "@raiquora/agent/in-trip-application-evidence";
import { calculateInTripReplanScope, replanScopeContext } from "@raiquora/trip/in-trip-replan";

describe("MultiStepAgentRuntime", () => {
  it("keeps conversation-echoed preferences out of Trace after Profile consent is removed", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const result = await new MultiStepAgentRuntime({ tools, toolExecutor, model: sequenceModel([textResponse("earlier-private-preference")]) }).run({
      ...request("続きを相談したい"), context: { conversation: { messages: [{ role: "assistant", text: "earlier-private-preference" }] } },
    });
    expect(result.response).toBe("earlier-private-preference");
    expect(JSON.stringify(result.trace)).not.toContain("earlier-private-preference");
    expect(result.trace.events.some((event) => event.type === "model_completed")).toBe(true);
  });
  it.each(['<tool_call>{"private":"REJECTED"}</tool_call>', '{"name":"first_tool","input":{"value":"REJECTED"}}'])("repairs envelope to native Tool Use: %s", async (invalid) => {
    const order: string[] = [], requests: AgentModelRequest[] = [];
    const { tools, toolExecutor } = toolSetup(order);
    const model = sequenceModel([textResponse(invalid), toolCallResponse([{ id: "native", name: "first_tool", input: { value: "accepted" } }])], requests);
    const result = await new MultiStepAgentRuntime({ tools, toolExecutor, model, terminalToolResult: () => "確認しました" }).run(request("調べて"));
    expect(result.status).toBe("completed"); expect(order).toEqual(["first_tool"]);
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("REJECTED");
    expect(JSON.stringify(requests[1])).not.toContain("REJECTED");
  });
  it.each([false, true])("repairs invalid Evidence references once (repeat=%s)", async (repeat) => {
    const requests: AgentModelRequest[] = [], { tools, toolExecutor } = toolSetup([]);
    const invalid = { ...textResponse("REJECTED"), declaredEvidenceIds: ["PRIVATE_UNKNOWN_ID"] };
    const model = sequenceModel([invalid, repeat ? invalid : textResponse("確認できません")], requests);
    const result = await new MultiStepAgentRuntime({ tools, toolExecutor, model }).run(request("調べて"));
    expect(result.status).toBe(repeat ? "failed" : "completed");
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toMatch(/REJECTED|PRIVATE_UNKNOWN_ID/);
    expect(JSON.stringify(requests[1])).not.toMatch(/REJECTED|PRIVATE_UNKNOWN_ID/);
  });
  it("gives repair only admitted Evidence IDs, not candidate IDs or invalid model IDs", async () => {
    const requests: AgentModelRequest[] = [], { tools, toolExecutor } = toolSetup([]);
    const invalid = { ...textResponse("候補を説明"), declaredEvidenceIds: ["candidate-b"] };
    const initial = evidence("verified-source"); initial.references[0]!.sourceType = "trip-state";
    await new MultiStepAgentRuntime({ tools, toolExecutor, model: sequenceModel([invalid, textResponse("確認できません")], requests) })
      .run({ ...request("候補を説明"), initialEvidence: [initial] });
    const repair = JSON.stringify(requests[1]);
    expect(repair).toContain("verified-source");
    expect(repair).not.toContain("candidate-b");
  });
  it.each(["answer", "ask_user", "native"])("normal %s needs no repair call", async (kind) => {
    const { tools, toolExecutor } = toolSetup([]);
    const answer = kind === "native" ? toolCallResponse([{ id: "native", name: "first_tool", input: { value: "ok" } }]) : textResponse("ご希望を教えてください");
    if (kind !== "native") answer.decisionSummary = { interpretedGoal: "対話", selectedAction: kind as "answer" | "ask_user", hardConstraints: [], softPreferences: [], unresolvedFacts: [], reasonCodes: [] };
    const model = sequenceModel([answer]);
    expect((await new MultiStepAgentRuntime({ tools, toolExecutor, model, terminalToolResult: () => "確認" }).run(request("確認"))).status).toBe("completed");
    expect(model.generate).toHaveBeenCalledTimes(1);
  });
  it("repairs general Tool prose once without retaining its payload", async () => {
    const { tools, toolExecutor } = toolSetup([]), requests: AgentModelRequest[] = [];
    const repaired = { ...textResponse("確認できません"), decisionSummary: {
      interpretedGoal: "確認", hardConstraints: [], softPreferences: [], selectedAction: "answer" as const,
      unresolvedFacts: [], reasonCodes: ["information_missing" as const],
    } };
    const model = sequenceModel([textResponse('<tool_call>{"private":"DO_NOT_REPLAY"}</tool_call>'), repaired], requests);
    const output = await new MultiStepAgentRuntime({ tools, toolExecutor, model }).run(request("調べて"));
    expect(output.status).toBe("completed");
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(output)).not.toContain("DO_NOT_REPLAY");
    expect(JSON.stringify(requests[1])).not.toContain("DO_NOT_REPLAY");
  });
  it("shares one repair budget across Tool prose and invalid Evidence IDs", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const model = sequenceModel([textResponse('<tool_call>{}</tool_call>'),
      { ...textResponse("京都から大阪へ1分"), declaredEvidenceIds: ["MISSING"] }]);
    const result = await new MultiStepAgentRuntime({ tools, toolExecutor, model }).run(request("経路"));
    expect(result.status).toBe("failed");
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(result.response).not.toContain("1分");
    expect(result.trace.events.filter(e => e.type === "tool_called")).toHaveLength(0);
  });
  it("ends on Application currentness failure without later batch Tools or silent replan", async () => {
    const tools = new AgentToolRegistry(), order: string[] = [];
    tools.register({ ...echoTool("first_tool", order), execute: async () => {
      order.push("first_tool");
      return failedAgentToolResult({ code: "precondition_failed", message: "Trip revision changed", retryable: false });
    } });
    tools.register(echoTool("second_tool", order));
    const model = sequenceModel([toolCallResponse([
      { id: "a", name: "first_tool", input: { value: "one" } },
      { id: "b", name: "second_tool", input: { value: "two" } },
    ])]);
    const result = await new MultiStepAgentRuntime({ tools, model,
      toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()),
      terminalToolFailure: () => "旅程が更新されたため、新しい変更案が必要です。保存していません。",
    }).run(request("変更案"));
    expect(result.status).toBe("completed");
    expect(result.response).toContain("保存していません");
    expect(order).toEqual(["first_tool"]);
    expect(model.generate).toHaveBeenCalledTimes(1);
  });
  it("bounds replan wire repair to one retry, never executes prose-encoded Tool calls", async () => {
    const f = inTripFixture(), { tools, toolExecutor } = toolSetup([]), requests: AgentModelRequest[] = [];
    const invalid = textResponse('<tool_call>{"name":"first_tool","input":{"value":"unsafe"}}</tool_call>');
    const model = sequenceModel([invalid, invalid], requests);
    const result = await new MultiStepAgentRuntime({ tools, toolExecutor, model }).run({ ...request("変更案"),
      context: { inTrip: f.snapshot, inTripReplanScope: replanScopeContext(calculateInTripReplanScope(f.trip, { now: new Date(f.now.at), reservations: [] })) },
      initialEvidence: inTripApplicationEvidence(f.snapshot) });
    expect(result.status).toBe("failed"); expect(model.generate).toHaveBeenCalledTimes(2);
    expect(result.trace.events.filter((e) => e.type === "tool_called")).toEqual([]);
    expect(result.trace.events.filter((e) => e.type === "replan_decided")).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("unsafe");
    expect(requests[1]?.messages.at(-1)).toMatchObject({ role: "user" });
  });
  it("returns only admitted Tool Evidence presentation references to the next model call", async () => {
    const { tools } = toolSetup([]), requests: AgentModelRequest[] = [], evidenceMappers = new ToolEvidenceRegistry();
    const toolExecutor = new AgentToolExecutor(tools, evidenceMappers);
    const toolEvidence = { ...evidence("tool-outcome"), knowledgeKind: "deterministic_fact" as const,
      facts: { resultKind: "weather", status: "unconfirmed", freshness: "unknown" },
      references: [{ ...evidence("ref").references[0]!, sourceType: "external-source" as const }] };
    evidenceMappers.register("first_tool", () => [toolEvidence]);
    const answer = textResponse("model fact must not appear");
    answer.decisionSummary = { interpretedGoal: "取得結果", hardConstraints: [], softPreferences: [], selectedAction: "answer",
      unresolvedFacts: [], reasonCodes: [], usedEvidenceIds: [toolEvidence.id],
      inTripAnswerPlan: { evidence: [{ evidenceId: toolEvidence.id, presentation: "external-result" }] } };
    const output = await new MultiStepAgentRuntime({ tools, toolExecutor, model: sequenceModel([
      toolCallResponse([{ id: "call", name: "first_tool", input: { value: "one" } }]), answer,
    ], requests) }).run({ ...request("最新天気"), context: { inTrip: inTripFixture().snapshot } });
    expect(output.status).toBe("completed");
    expect(output.response).toContain("最新情報は確認できていません");
    expect(JSON.stringify(requests[1]!.messages)).toContain('\\"presentations\\":[\\"external-result\\"]');
    expect(output.response).not.toContain("model fact");
  });
  it.each(["valid", "invalid-metadata", "invalid-metadata-subset", "invalid-metadata-missing", "missing", "mismatched", "subset"])("in-trip %s plan cannot publish model-authored facts", async (kind) => {
    const { snapshot } = inTripFixture(), initialEvidence = inTripApplicationEvidence(snapshot);
    const { tools, toolExecutor } = toolSetup([]), answer = textResponse("現在、列車で移動中です。乗換は問題ありません。秘密: RAW");
    const e = initialEvidence.find((e) => e.coverage?.includes("rail.connection"))!;
    answer.decisionSummary = { interpretedGoal: "接続を説明", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["evidence_sufficient"],
      usedEvidenceIds: kind === "subset" ? [] : [e.id], ...(kind === "missing" ? {} : { inTripAnswerPlan: { evidence: [{ evidenceId: e.id,
        presentation: kind === "mismatched" ? "location-permission" : "rail-impact" }] } }) };
    if (kind.startsWith("invalid-metadata")) {
      answer.declaredInTripAnswerPlan = answer.decisionSummary.inTripAnswerPlan;
      answer.declaredEvidenceIds = kind.endsWith("subset") ? [] : [e.id];
      if (kind.endsWith("missing")) answer.declaredInTripAnswerPlan!.evidence[0]!.evidenceId = "unknown";
      delete answer.decisionSummary;
      answer.decisionSummaryStatus = "invalid";
    }
    const output = await new MultiStepAgentRuntime({ tools, toolExecutor, model: sequenceModel([answer]) }).run({ ...request("大丈夫？"), context: { inTrip: snapshot }, initialEvidence });
    expect(output.status).toBe(["valid", "invalid-metadata"].includes(kind) ? "completed" : "failed");
    expect(JSON.stringify(output)).not.toContain("RAW");
    if (kind === "valid") {
      expect(output.response).toContain("見込み4分");
      expect(output.trace.events.find((e) => e.type === "decision_recorded")).toMatchObject({ inTripAnswerPlan: answer.decisionSummary!.inTripAnswerPlan });
    }
  });
  it("validates declared references independently of other invalid decision fields", async () => {
    const { tools, toolExecutor } = toolSetup([]), response = textResponse("unsafe answer");
    response.decisionSummaryStatus = "invalid"; response.declaredEvidenceIds = ["missing"];
    const output = await new MultiStepAgentRuntime({ tools, toolExecutor, model: sequenceModel([response]) }).run(request("説明"));
    expect(output.status).toBe("failed");
    expect(output.trace.events.some((e) => e.type === "response_generated" && e.response.includes("unsafe answer"))).toBe(false);
  });
  it.each([["missing"], ["app", "app"], Array.from({ length: 11 }, () => "app")])("rejects invalid used Evidence before publishing an answer", async (...ids) => {
    const { tools, toolExecutor } = toolSetup([]), response = textResponse("unsafe answer");
    response.decisionSummary = { interpretedGoal: "説明", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: [], usedEvidenceIds: ids };
    const output = await new MultiStepAgentRuntime({ tools, toolExecutor, model: sequenceModel([response]) }).run({ ...request("説明して"), initialEvidence: [evidence("app")] });
    expect(output.status).toBe("failed");
    expect(output.trace.events.some((e) => e.type === "response_generated" && e.response.includes("unsafe answer"))).toBe(false);
  });
  it("registers initial Evidence before the model, traces it and permits a Tool-free grounded answer", async () => {
    const { tools, toolExecutor } = toolSetup([]), requests: AgentModelRequest[] = [];
    const initial = evidence("application:plan"); initial.references[0]!.sourceType = "trip-state";
    const claims = supportedAnswerClaims([initial]);
    const answer = textResponse(JSON.stringify({ text: claims.map((c) => c.statement).join("\n\n"), claims }));
    answer.decisionSummary = { interpretedGoal: "次予定", hardConstraints: [], softPreferences: [], selectedAction: "answer", unresolvedFacts: [], reasonCodes: ["evidence_sufficient"], usedEvidenceIds: [initial.id] };
    const model = sequenceModel([answer], requests);
    const runtime = new MultiStepAgentRuntime({ tools, toolExecutor, model });
    const output = await runtime.run({ ...request("次は？"), initialEvidence: [initial] });
    expect(output.evidence).toEqual([initial]); expect(output.status).toBe("completed");
    expect(JSON.stringify(requests[0]!.messages)).toContain("application:plan");
    expect(output.trace.events.findIndex((e) => e.type === "evidence_collected")).toBeLessThan(output.trace.events.findIndex((e) => e.type === "model_started"));
    expect(output.trace.events.filter((e) => e.type === "tool_called")).toHaveLength(0);
    expect(model.generate).toHaveBeenCalledOnce();
    expect(output.trace.events.find((e) => e.type === "decision_recorded")).toMatchObject({ usedEvidenceIds: [initial.id] });
  });
  it("shares the twenty Evidence budget with Tools and retains Application Evidence at finalization", async () => {
    const order: string[] = [], { tools, toolExecutor } = toolSetup(order), requests: AgentModelRequest[] = [];
    const initialEvidence = Array.from({ length: 19 }, (_, i) => evidence(`app-${i}`));
    const runtime = new MultiStepAgentRuntime({ tools, toolExecutor, limits: { maxToolCalls: 2 }, model: sequenceModel([
      toolCallResponse([{ id: "a", name: "first_tool", input: { value: "one" } }, { id: "b", name: "second_tool", input: { value: "two" } }]),
      textResponse("両方の根拠から回答します"),
    ], requests) });
    const output = await runtime.run({ ...request("追加情報を確認して"), initialEvidence });
    expect(output.evidence).toHaveLength(20); expect(output.evidence.slice(0, 19)).toEqual(initialEvidence);
    expect(output.evidence[19]!.id).toBe("first_tool:one"); expect(order).toEqual(["first_tool", "second_tool"]);
    expect(JSON.stringify(requests[1]!.messages)).toContain("Application Evidence + 今回のTool Evidence");
    expect(JSON.stringify(requests[1]!.messages)).toContain("app-0");
  });
  it.each(["duplicate", "no-reference", "empty-reference", "over-budget"])("rejects invalid initial Evidence before model use: %s", async (kind) => {
    const { tools, toolExecutor } = toolSetup([]), value = evidence("app"), model = sequenceModel([textResponse("unexpected")]);
    const initialEvidence = kind === "duplicate" ? [value, value] : kind === "no-reference" ? [{ ...value, references: [] }] :
      kind === "empty-reference" ? [{ ...value, references: [{ ...value.references[0]!, sourceRef: "" }] }] :
      Array.from({ length: 21 }, (_, i) => evidence(`app-${i}`));
    const output = await new MultiStepAgentRuntime({ tools, toolExecutor, model }).run({ ...request("確認"), initialEvidence });
    expect(output.status).toBe("failed"); expect(output.evidence).toEqual([]); expect(model.generate).not.toHaveBeenCalled();
  });
  it.each(["precondition_failed", "execution_failed"] as const)("re-evaluates only context-dependent failures after progress: %s", async (code) => {
    const { tools, toolExecutor } = toolSetup([]);
    const execute = vi.fn(async () => execute.mock.calls.length === 1
      ? failedAgentToolResult({ code, message: "必要な資料がありません", retryable: false })
      : successfulAgentToolResult({ matched: true }));
    tools.register({
      name: "resolve_candidate", description: "確認済み資料から照合する",
      inputSchema: { type: "object", properties: {} },
      parseInput: () => validAgentToolInput({}), execute,
    });
    const requests: AgentModelRequest[] = [];
    const runtime = new MultiStepAgentRuntime({ tools, toolExecutor, limits: { maxIterations: 6, maxModelCalls: 6 }, model: sequenceModel([
      toolCallResponse([{ id: "before", name: "resolve_candidate", input: {} }]),
      toolCallResponse([{ id: "source", name: "first_tool", input: { value: "公開資料" } }]),
      toolCallResponse([{ id: "after", name: "resolve_candidate", input: {} }]),
      textResponse("取得できた資料をもとに回答します"),
    ], requests) });
    const output = await runtime.run(request("資料を調べて候補を確認して"));
    expect(execute).toHaveBeenCalledTimes(code === "precondition_failed" ? 2 : 1);
    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "tool_completed", toolCallId: "after", outcome: code === "precondition_failed" ? "success" : "error",
    }));
  });

  it("does not repeat a precondition failure while task context is unchanged", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const execute = vi.fn(async () => failedAgentToolResult({ code: "precondition_failed", message: "先に資料が必要", retryable: false }));
    tools.register({ name: "resolve_candidate", description: "照合", inputSchema: { type: "object", properties: {} }, parseInput: () => validAgentToolInput({}), execute });
    const runtime = new MultiStepAgentRuntime({ tools, toolExecutor, model: sequenceModel([
      toolCallResponse([{ id: "first", name: "resolve_candidate", input: {} }]),
      toolCallResponse([{ id: "duplicate", name: "resolve_candidate", input: {} }]),
      textResponse("資料が足りません"),
    ]) });
    await runtime.run(request("確認して"));
    expect(execute).toHaveBeenCalledOnce();
  });

  it("does not unblock a permanent failure on the same tool when another precondition recovers", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    tools.register({
      name: "resolve_candidate", description: "照合", inputSchema: { type: "object", properties: {} },
      parseInput: (input) => validAgentToolInput(input as Record<string, unknown>),
      execute: async (input) => failedAgentToolResult({
        code: input.mode === "missing" ? "precondition_failed" : "execution_failed",
        message: input.mode === "missing" ? "資料不足" : "アクセス拒否", retryable: false,
      }),
    });
    const requests: AgentModelRequest[] = [];
    const runtime = new MultiStepAgentRuntime({ tools, toolExecutor, model: sequenceModel([
      toolCallResponse([
        { id: "missing", name: "resolve_candidate", input: { mode: "missing" } },
        { id: "denied", name: "resolve_candidate", input: { mode: "denied" } },
        { id: "denied-again", name: "resolve_candidate", input: { mode: "denied" } },
      ]),
      toolCallResponse([{ id: "source", name: "first_tool", input: { value: "公開資料" } }]),
      textResponse("確認できない情報があります"),
    ], requests) });
    await runtime.run(request("資料を確認して"));
    expect(requests).toHaveLength(3);
    expect(requests[2]?.tools).toBeDefined();
    expect(requests[2]?.tools?.map(({ name }) => name)).not.toContain("resolve_candidate");
  });

  it("executes multiple domain tools in order and gives their results back to the model", async () => {
    const executionOrder: string[] = [];
    const { tools, toolExecutor } = toolSetup(executionOrder);
    const requests: AgentModelRequest[] = [];
    const model = sequenceModel([
      toolCallResponse([
        { id: "call-a", name: "first_tool", input: { value: "京都" } },
        { id: "call-b", name: "second_tool", input: { value: "出雲市" } },
      ]),
      textResponse("京都から出雲市への候補です"),
    ], requests);
    const runtime = new MultiStepAgentRuntime({
      model,
      tools,
      toolExecutor,
      now: tickingClock(),
    });

    const output = await runtime.run(request("京都から出雲市へ行きたい"));

    expect(output.status).toBe("completed");
    expect(output.response).toBe("京都から出雲市への候補です");
    expect(executionOrder).toEqual(["first_tool", "second_tool"]);
    expect(output.evidence.map(({ id }) => id)).toEqual([
      "first_tool:京都",
      "second_tool:出雲市",
    ]);
    expect(requests).toHaveLength(2);
    expect(requests.every(({ modelCallId }) => typeof modelCallId === "string")).toBe(true);
    expect(requests[0]?.modelCallId).not.toBe(requests[1]?.modelCallId);
    expect({ ...requests[1].messages.at(-1), content: requests[1].messages.at(-1)!.content.filter((c) => c.type === "tool_result") }).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          toolCallId: "call-a",
          status: "success",
          output: { toolName: "first_tool", value: "京都" },
        },
        {
          type: "tool_result",
          toolCallId: "call-b",
          status: "success",
          output: { toolName: "second_tool", value: "出雲市" },
        },
      ],
    });
    expect(output.trace.events.map(({ type }) => type)).toEqual([
      "task_started",
      "intent_normalized",
      "plan_created",
      "model_started",
      "model_completed",
      "decision_recorded",
      "decision_recorded",
      "tool_called",
      "tool_completed",
      "evidence_collected",
      "tool_called",
      "tool_completed",
      "evidence_collected",
      "replan_decided",
      "model_started",
      "model_completed",
      "decision_recorded",
      "response_generated",
      "task_completed",
    ]);
    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "decision_recorded",
      interpretedGoal: "京都から出雲市へ行きたい",
      selectedAction: "use_tool",
      selectedTool: "first_tool",
      reasonCodes: ["initial_capability_selection"],
    }));
  });

  it("returns a follow-up without calling the model when problem framing finds missing data", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const generate = vi.fn<AgentModelProvider["generate"]>();
    const runtime = new MultiStepAgentRuntime({
      model: { generate },
      tools,
      toolExecutor,
    });

    const output = await runtime.run(request("   "));

    expect(output.status).toBe("follow_up");
    expect(output.response).toContain("教えてください");
    expect(generate).not.toHaveBeenCalled();
  });

  it("passes an explicitly configured model class without adding routing heuristics", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const requests: AgentModelRequest[] = [];
    const runtime = new MultiStepAgentRuntime({
      model: sequenceModel([textResponse("案内します")], requests),
      modelClass: "decision",
      tools,
      toolExecutor,
    });

    await runtime.run(request("相談したい"));

    expect(requests[0]?.modelClass).toBe("decision");
  });

  it("selects a model class per structured runtime phase without another model call", async () => {
    const executionOrder: string[] = [];
    const { tools, toolExecutor } = toolSetup(executionOrder);
    const requests: AgentModelRequest[] = [];
    const runtime = new MultiStepAgentRuntime({
      model: sequenceModel([
        toolCallResponse([{ id: "call-a", name: "first_tool", input: { value: "京都" } }]),
        textResponse("確認しました"),
      ], requests),
      modelClassPolicy: ({ phase }) => phase === "result_driven_replan"
        ? "decision"
        : undefined,
      tools,
      toolExecutor,
    });

    await runtime.run(request("京都を確認して"));

    expect(requests).toHaveLength(2);
    expect(requests[0]?.modelClass).toBeUndefined();
    expect(requests[1]?.modelClass).toBe("decision");
  });

  it("records a validated model decision summary without an extra model call", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const response = toolCallResponse([
      { id: "call-a", name: "first_tool", input: { value: "京都" } },
    ]);
    response.decisionSummaryStatus = "valid";
    response.decisionSummary = {
      interpretedGoal: "京都から出雲へ移動する",
      hardConstraints: [{ key: "origin", value: "京都" }],
      softPreferences: [{ key: "pace", value: "slow" }],
      selectedAction: "use_tool",
      selectedTool: "first_tool",
      unresolvedFacts: ["destination_station"],
      reasonCodes: ["constraint_applied", "evidence_required"],
    };
    const model = sequenceModel([response, textResponse("候補です")]);
    const runtime = new MultiStepAgentRuntime({ model, tools, toolExecutor });

    const output = await runtime.run(request("京都から出雲へ"));

    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "decision_recorded",
      interpretedGoal: "京都から出雲へ移動する",
      selectedTool: "first_tool",
      unresolvedFacts: ["destination_station"],
      reasonCodes: ["constraint_applied", "evidence_required"],
      hardConstraints: expect.objectContaining({
        value: [{ key: "origin", value: "京都", source: "agent_interpretation" }],
      }),
    }));
  });

  it("falls back to observable decisions when a decision summary is invalid", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const response = toolCallResponse([
      { id: "call-a", name: "first_tool", input: { value: "京都" } },
    ]);
    response.decisionSummaryStatus = "invalid";
    const runtime = new MultiStepAgentRuntime({
      model: sequenceModel([response, textResponse("候補です")]),
      tools,
      toolExecutor,
    });

    const output = await runtime.run(request("京都から出雲へ"));

    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "decision_recorded",
      selectedTool: "first_tool",
      reasonCodes: ["decision_summary_invalid"],
    }));
  });

  it("stops before executing tools when the tool count limit would be exceeded", async () => {
    const executionOrder: string[] = [];
    const { tools, toolExecutor } = toolSetup(executionOrder);
    const runtime = new MultiStepAgentRuntime({
      model: sequenceModel([toolCallResponse([
        { id: "call-a", name: "first_tool", input: { value: "a" } },
        { id: "call-b", name: "second_tool", input: { value: "b" } },
      ])]),
      tools,
      toolExecutor,
      limits: { maxToolCalls: 1 },
    });

    const output = await runtime.run(request("2つ調べて"));

    expect(output.status).toBe("limit_reached");
    expect(executionOrder).toEqual([]);
    expect(output.trace.events.at(-1)).toMatchObject({
      type: "task_completed",
      status: "failed",
      reason: "runtime_limit_reached",
    });
  });

  it("stops offering a tool after the same non-retryable failure repeats", async () => {
    const executionOrder: string[] = [];
    const { tools, toolExecutor } = toolSetup(executionOrder);
    const blockedExecute = vi.fn(async () =>
      successfulAgentToolResult({ recovered: false }));
    tools.register({
      name: "blocked_tool",
      description: "前提不足では実行できないTool",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      parseInput: () => invalidAgentToolInput("具体的な候補のEvidenceが必要です。"),
      execute: blockedExecute,
    });
    const requests: AgentModelRequest[] = [];
    const model = sequenceModel([
      toolCallResponse([{ id: "blocked-1", name: "blocked_tool", input: {} }]),
      toolCallResponse([{ id: "blocked-2", name: "blocked_tool", input: {} }]),
      toolCallResponse([{
        id: "recovery",
        name: "second_tool",
        input: { value: "候補を探索" },
      }]),
      textResponse("候補を確認しました"),
    ], requests);
    const runtime = new MultiStepAgentRuntime({
      model,
      tools,
      toolExecutor,
      limits: { maxIterations: 6, maxModelCalls: 7 },
    });

    const output = await runtime.run(request("リフレッシュした旅行をしたい"));

    expect(output.status).toBe("completed");
    expect(output.response).toBe("候補を確認しました");
    expect(blockedExecute).not.toHaveBeenCalled();
    expect(executionOrder).toEqual(["second_tool"]);
    expect(requests[0]?.tools?.map(({ name }) => name)).toContain("blocked_tool");
    expect(requests[1]?.tools?.map(({ name }) => name)).toContain("blocked_tool");
    expect(requests[2]?.tools?.map(({ name }) => name)).not.toContain("blocked_tool");
    expect(requests[2]?.tools?.map(({ name }) => name)).toContain("second_tool");
    expect(requests[3]?.tools?.map(({ name }) => name)).not.toContain("blocked_tool");
    expect(requests[2]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.arrayContaining([
        { type: "text", text: expect.stringContaining("別のTool") },
      ]),
    });
    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "replan_decided",
      reason: "同じ再試行不可エラーを繰り返したToolを除外して再計画する",
    }));
  });

  it("does not execute the same Tool input twice and uses the next call for a final answer", async () => {
    const executionOrder: string[] = [];
    const { tools, toolExecutor } = toolSetup(executionOrder);
    const requests: AgentModelRequest[] = [];
    const duplicateCall = { value: "静かな温泉" };
    const runtime = new MultiStepAgentRuntime({
      model: sequenceModel([
        toolCallResponse([{ id: "search-1", name: "first_tool", input: duplicateCall }]),
        toolCallResponse([{
          id: "search-duplicate",
          name: "first_tool",
          input: { value: "静かな温泉" },
        }]),
        textResponse("確認できた候補を案内します"),
      ], requests),
      tools,
      toolExecutor,
      limits: { maxIterations: 5, maxModelCalls: 6 },
    });

    const output = await runtime.run(request("静かな温泉を探して"));

    expect(output.status).toBe("completed");
    expect(output.response).toBe("確認できた候補を案内します");
    expect(executionOrder).toEqual(["first_tool"]);
    expect(requests).toHaveLength(3);
    expect(requests[2]?.tools?.map(({ name }) => name)).toEqual([
      "first_tool",
      "second_tool",
    ]);
    expect(requests[2]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: expect.arrayContaining([
        { type: "text", text: expect.stringContaining("最終回答フェーズ") },
      ]),
    });
    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "tool_completed",
      toolCallId: "search-duplicate",
      outcome: "error",
      errorCode: "invalid_input",
      retryable: false,
    }));
    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "replan_decided",
      reason: "同一入力のTool再実行を止めて確認済み結果から最終回答する",
    }));
  });

  it("reserves the last iteration for an evidence-bounded final answer", async () => {
    const executionOrder: string[] = [];
    const { tools, toolExecutor } = toolSetup(executionOrder);
    const requests: AgentModelRequest[] = [];
    const runtime = new MultiStepAgentRuntime({
      model: sequenceModel([
        toolCallResponse([{ id: "search-1", name: "first_tool", input: { value: "候補" } }]),
        toolCallResponse([{ id: "search-2", name: "second_tool", input: { value: "詳細" } }]),
        textResponse("確認できた範囲と不足情報を案内します"),
      ], requests),
      tools,
      toolExecutor,
      limits: { maxIterations: 3, maxModelCalls: 4 },
    });

    const output = await runtime.run(request("候補の詳細を調べて"));

    expect(output.status).toBe("completed");
    expect(output.response).toBe("確認できた範囲と不足情報を案内します");
    expect(executionOrder).toEqual(["first_tool", "second_tool"]);
    expect(requests).toHaveLength(3);
    expect(requests[2]?.tools?.map(({ name }) => name)).toEqual([
      "first_tool",
      "second_tool",
    ]);
  });

  it("does not execute another Tool requested during the final response phase", async () => {
    const executionOrder: string[] = [];
    const { tools, toolExecutor } = toolSetup(executionOrder);
    const runtime = new MultiStepAgentRuntime({
      model: sequenceModel([
        toolCallResponse([{ id: "search-1", name: "first_tool", input: { value: "候補" } }]),
        toolCallResponse([{ id: "search-2", name: "second_tool", input: { value: "詳細" } }]),
        toolCallResponse([{ id: "search-3", name: "first_tool", input: { value: "追加" } }]),
      ]),
      tools,
      toolExecutor,
      limits: { maxIterations: 3, maxModelCalls: 4 },
    });

    const output = await runtime.run(request("候補の詳細を調べて"));

    expect(output.status).toBe("limit_reached");
    expect(executionOrder).toEqual(["first_tool", "second_tool"]);
  });

  it("bounds iterations model calls and collected evidence", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const model = sequenceModel([
      toolCallResponse([{ id: "call-a", name: "first_tool", input: { value: "a" } }]),
      textResponse("呼ばれない"),
    ]);
    const runtime = new MultiStepAgentRuntime({
      model,
      tools,
      toolExecutor,
      limits: { maxIterations: 1, maxModelCalls: 2, maxEvidence: 1 },
    });

    const output = await runtime.run(request("調べて"));

    expect(output.status).toBe("limit_reached");
    expect(output.evidence).toHaveLength(1);
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it("distinguishes provider failure from an execution timeout", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const failed = new MultiStepAgentRuntime({
      model: { generate: async () => Promise.reject(new Error("provider secret")) },
      tools,
      toolExecutor,
    });
    const timedOut = new MultiStepAgentRuntime({
      model: { generate: () => new Promise(() => undefined) },
      tools,
      toolExecutor,
      limits: { maxExecutionMs: 2 },
    });

    const failure = await failed.run(request("検索して"));
    const timeout = await timedOut.run(request("検索して"));

    expect(failure.status).toBe("failed");
    const startedModelCall = failure.trace.events.find((event) =>
      event.type === "model_started");
    const failedModelCall = failure.trace.events.find((event) =>
      event.type === "model_failed");
    expect(startedModelCall).toMatchObject({ type: "model_started" });
    expect(failedModelCall).toMatchObject({
      type: "model_failed",
      modelCallId: startedModelCall && "modelCallId" in startedModelCall
        ? startedModelCall.modelCallId
        : undefined,
      reason: "provider_error",
    });
    expect(JSON.stringify(failure.trace)).not.toContain("provider secret");
    expect(timeout.status).toBe("limit_reached");
  });

  it("does not present a max-token response as a completed answer", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const response = textResponse("途中までの回答");
    response.stopReason = "max_tokens";
    const runtime = new MultiStepAgentRuntime({
      model: sequenceModel([response]),
      tools,
      toolExecutor,
    });

    const output = await runtime.run(request("検索して"));

    expect(output.status).toBe("limit_reached");
    expect(output.response).not.toContain("途中までの回答");
  });

  it("retries when the model returns only internal reasoning", async () => {
    const { tools, toolExecutor } = toolSetup([]);
    const requests: AgentModelRequest[] = [];
    const model = sequenceModel([
      textResponse("<thinking>次に日付を質問する</thinking>"),
      textResponse("旅行の日付を教えてください"),
    ], requests);
    const runtime = new MultiStepAgentRuntime({ model, tools, toolExecutor });

    const output = await runtime.run(request("2泊"));

    expect(output.status).toBe("completed");
    expect(output.response).toBe("旅行の日付を教えてください");
    expect(output.response).not.toContain("thinking");
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(requests[1]?.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("内部推論") }],
    });
    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "replan_decided",
      reason: "内部推論だけの応答を破棄して利用者向け応答を再要求する",
    }));
  });

  it("replans when a feature policy rejects an unverified final response", async () => {
    const executionOrder: string[] = [];
    const { tools, toolExecutor } = toolSetup(executionOrder);
    const requests: AgentModelRequest[] = [];
    const model = sequenceModel([
      textResponse("確認せずに作った候補です"),
      toolCallResponse([{ id: "verified", name: "first_tool", input: { value: "出雲" } }]),
      textResponse("確認済みの候補です"),
    ], requests);
    const runtime = new MultiStepAgentRuntime({
      model,
      tools,
      toolExecutor,
      finalResponsePolicy: (_response, _request) => ({
        accepted: executionOrder.length > 0,
        reason: "旅行候補をToolで検証する",
        instruction: "旅行候補をToolで検索してください",
      }),
    });

    const output = await runtime.run(request("出雲へ旅行したい"));

    expect(output.response).toBe("確認済みの候補です");
    expect(executionOrder).toEqual(["first_tool"]);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "旅行候補をToolで検索してください" }],
    });
    expect(output.trace.events).toContainEqual(expect.objectContaining({
      type: "replan_decided",
      reason: "旅行候補をToolで検証する",
    }));
  });
  it("does not let a planning turn ask again for optional trip details", async () => {
    const { tools, toolExecutor } = toolSetup([]), requests: AgentModelRequest[] = [];
    const question = textResponse("出発地を教えてください");
    question.decisionSummary = { interpretedGoal: "旅行を計画", hardConstraints: [], softPreferences: [], selectedAction: "ask_user",
      unresolvedFacts: ["origin"], reasonCodes: ["information_missing"] };
    const model = sequenceModel([question, textResponse("未確認条件を仮定した仮プランです")], requests);
    const output = await new MultiStepAgentRuntime({ tools, toolExecutor, model }).run({
      executionId: "planning", feature: "concierge", userRequest: "明日から1泊で旅行したい",
      context: { tripContext: { planningStage: "planning", destinationWish: "出雲大社", startDate: "2026-09-22", stayNights: 1 } },
    });
    expect(output.status).toBe("completed");
    expect(output.response).toContain("仮プラン");
    expect(output.response).not.toContain("出発地を教えて");
    expect(requests[1]?.messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "text", text: expect.stringContaining("質問だけで終えず") }] });
  });
});

function toolSetup(executionOrder: string[]) {
  const tools = new AgentToolRegistry();
  const evidenceMappers = new ToolEvidenceRegistry();
  for (const name of ["first_tool", "second_tool"]) {
    tools.register(echoTool(name, executionOrder));
    evidenceMappers.register(name, (output) => {
      const value = (output as { value: string }).value;
      return [evidence(`${name}:${value}`)];
    });
  }
  return {
    tools,
    evidenceMappers,
    toolExecutor: new AgentToolExecutor(tools, evidenceMappers),
  };
}

function echoTool(
  name: string,
  executionOrder: string[],
): AgentTool<{ value: string }, { toolName: string; value: string }> {
  return {
    name,
    description: `${name}を実行する`,
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    parseInput: (value) => validAgentToolInput(value as { value: string }),
    execute: async ({ value }) => {
      executionOrder.push(name);
      return successfulAgentToolResult({ toolName: name, value });
    },
  };
}

function sequenceModel(
  responses: AgentModelResponse[],
  requests: AgentModelRequest[] = [],
): AgentModelProvider & { generate: ReturnType<typeof vi.fn<AgentModelProvider["generate"]>> } {
  let index = 0;
  const generate = vi.fn<AgentModelProvider["generate"]>(async (input) => {
    requests.push(structuredClone(input));
    const response = responses[index];
    index += 1;
    if (!response) throw new Error("unexpected model call");
    return response;
  });
  return { generate };
}

function toolCallResponse(
  calls: Array<{ id: string; name: string; input: Record<string, unknown> }>,
): AgentModelResponse {
  return {
    message: {
      role: "assistant",
      content: calls.map(({ id, name, input }) => ({
        type: "tool_call" as const,
        toolCallId: id,
        name,
        input,
      })),
    },
    stopReason: "tool_calls",
    metadata: { provider: "fixed", latencyMs: 1 },
  };
}

function textResponse(text: string): AgentModelResponse {
  return {
    message: { role: "assistant", content: [{ type: "text", text }] },
    stopReason: "completed",
    metadata: {
      provider: "fixed",
      model: "fixture-model",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    },
  };
}

function request(userRequest: string) {
  return {
    executionId: "execution-1",
    feature: "journey_planning" as const,
    userRequest,
  };
}

function evidence(id: string): Evidence {
  return {
    id,
    category: "journey",
    knowledgeKind: "deterministic_fact",
    subject: id,
    facts: {},
    references: [{
      sourceType: "timetable-graph",
      sourceRef: id,
      retrievedAt: null,
      freshness: "scheduled",
      summary: "fixture",
    }],
  };
}

function tickingClock(): () => Date {
  let milliseconds = Date.parse("2026-08-25T09:00:00.000Z");
  return () => {
    const date = new Date(milliseconds);
    milliseconds += 1;
    return date;
  };
}
