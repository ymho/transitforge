import { describe, expect, it, vi } from "vitest";

import { MultiStepAgentRuntime } from "./agent-runtime";
import { AgentToolExecutor } from "./agent-tool-executor";
import type { Evidence } from "./evidence-model";
import type {
  AgentModelProvider,
  AgentModelRequest,
  AgentModelResponse,
} from "./model-provider";
import {
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentTool,
} from "./tool-contract";
import { ToolEvidenceRegistry } from "./tool-evidence-registry";
import { AgentToolRegistry } from "./tool-registry";

describe("MultiStepAgentRuntime", () => {
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
    expect(requests[1].messages.at(-1)).toEqual({
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
