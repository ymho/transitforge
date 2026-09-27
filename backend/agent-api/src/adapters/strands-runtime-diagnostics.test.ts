import { expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import type { AgentDiagnosticEvent } from "../ports/agent-diagnostics.js";
import { ServerAgentRuntimeExecutionError } from "../ports/server-agent-runtime.js";
import { createServerAgentApplication } from "../usecases/agent/server-agent.js";
import { createConversationServerAgent } from "../composition/conversation-server-agent.js";
import { stateA, stateDynamoFixture, stateMetadata, conversationId } from "./state-dynamodb.fixture.js";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { StrandsAgentEngine, type StrandsAgentLike } from "./strands-agent-engine.js";
import { createStrandsServerRuntime } from "./strands-server-runtime.js";
import { strandsExecutionDiagnostic } from "./strands-execution-diagnostic.js";

it("wraps an SDK/provider invoke throw into bounded runtime metadata without retaining its message", async () => {
  const error = new Error("PRIVATE_PROVIDER_DETAIL");
  error.name = "ServiceUnavailableException";
  const tools = new AgentToolRegistry();
  const evidence = new ToolEvidenceRegistry();
  const engine = new StrandsAgentEngine({
    modelId: "unused", region: "ap-northeast-1", systemPrompt: "test", maxTurns: 2,
  }, { createAgent: () => ({ invoke: async () => { throw error; } }) });
  const executor = new AgentToolExecutor(tools, evidence);
  let caught: unknown;
  try {
    await engine.run({ executionId: "runtime-diagnostics", userRequest: "PRIVATE_REQUEST", tools, toolExecutor: executor });
  } catch (value) { caught = value; }
  expect(caught).toBeInstanceOf(ServerAgentRuntimeExecutionError);
  expect(caught).toMatchObject({ stage: "agent_invoke", kind: "provider" });
  expect(String(caught)).not.toContain("PRIVATE_PROVIDER_DETAIL");
  expect(String(caught)).not.toContain("PRIVATE_REQUEST");
});

it.each([
  ["limitOutputTokens", "output_token_budget"], ["limitTotalTokens", "total_token_budget"],
  ["limitTurns", "iteration_budget"], ["maxTokens", "model_output_limit"],
  ["modelContextWindowExceeded", "context_window_limit"], ["cancelled", "cancelled"],
  ["endTurn", "completed"], ["toolUse", "completed"], ["stopSequence", "completed"],
  ["contentFiltered", "provider_refusal"], ["guardrailIntervened", "provider_refusal"],
])("classifies %s independently of publication", (stopReason, reason) => {
  expect(strandsExecutionDiagnostic({ stopReason })).toEqual({ stopReason, reason });
});

it("retains local limit causes independently of the SDK stop reason", () => {
  expect(strandsExecutionDiagnostic({ stopReason: "cancelled", limitReason: "deadline" }))
    .toEqual({ reason: "deadline", stopReason: "cancelled", limitReason: "deadline" });
  expect(strandsExecutionDiagnostic({ stopReason: "endTurn", limitReason: "tool_calls" }))
    .toEqual({ reason: "tool_budget", stopReason: "endTurn", limitReason: "tool_calls" });
});

it("projects only nonnegative integer measurements, retaining zero but not manufacturing missing usage", () => {
  expect(strandsExecutionDiagnostic()).toEqual({ reason: "failed", stopReason: "not_recorded" });
  const result = strandsExecutionDiagnostic({ stopReason: "PRIVATE_STOP", limitReason: "PRIVATE_LIMIT", metrics: {
    modelCalls: 0, toolCalls: -1, inputTokens: "PRIVATE_TOKENS", outputTokens: Infinity, totalTokens: 1.5,
    lastMessage: "PRIVATE_REPLY", trace: "PRIVATE_TRACE", credentials: "PRIVATE_SECRET",
  } });
  expect(result).toEqual({ reason: "failed", stopReason: "unknown", counts: { modelCalls: 0 } });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "3", null]) {
    expect(strandsExecutionDiagnostic({ metrics: { outputTokens: value } }).counts).toBeUndefined();
  }
  expect(strandsExecutionDiagnostic({ stopReason: "__proto__" }).stopReason).toBe("unknown");
});

function application(invoke: StrandsAgentLike["invoke"], record = vi.fn(async (_event: AgentDiagnosticEvent): Promise<void> => undefined)) {
  const engine = new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1", systemPrompt: "test", maxTurns: 2 },
    { createAgent: () => ({ invoke }) });
  const app = createServerAgentApplication({ newExecutionId: () => "test-execution", registerTools: () => undefined,
    createModel: () => { throw new Error("V1 must not run"); }, runRuntime: createStrandsServerRuntime(engine), diagnostics: { record } });
  return { record, run: () => app.runAgentTurn({ principal: stateA, userRequest: "PRIVATE_REQUEST" }) };
}

it("records an SDK stop before publication rejection without treating the missing reply as success", async () => {
  const test = application(async () => ({ stopReason: "endTurn" }));
  expect(await test.run()).toMatchObject({ status: "failed", publicationError: "missing_structured_output" });
  const events = test.record.mock.calls.map(([event]) => event);
  expect(events.filter(event => event.phase === "execution")).toEqual([
    expect.objectContaining({ reason: "completed", stopReason: "endTurn", incomplete: false }),
  ]);
  expect(events.find(event => event.phase === "execution")?.counts).toBeUndefined();
  expect(events).toContainEqual(expect.objectContaining({ phase: "runtime", reason: "failed", mode: "v2:publication:missing_structured_output" }));
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
});

it("reports unavailable usage on an SDK exception and preserves the original bounded failure", async () => {
  const invoke = vi.fn(async () => { const error = new Error("PRIVATE_PROVIDER_MESSAGE"); error.name = "ServiceUnavailableException"; throw error; });
  const test = application(invoke);
  await expect(test.run()).rejects.toMatchObject({ stage: "agent_invoke", kind: "provider" });
  const events = test.record.mock.calls.map(([event]) => event);
  const execution = events.filter(event => event.phase === "execution");
  expect(execution).toHaveLength(1);
  expect(execution[0]).toMatchObject({ stopReason: "not_recorded", reason: "failed" });
  expect(execution[0]?.counts).toBeUndefined();
  expect(events).toContainEqual(expect.objectContaining({ phase: "runtime", mode: "v2:agent_invoke:provider" }));
  expect(JSON.stringify(events)).not.toContain("PRIVATE");
  expect(invoke).toHaveBeenCalledOnce();
});

it("a failed execution sink cannot change the reply or cause another model invocation", async () => {
  const invoke = vi.fn(async () => ({ stopReason: "toolUse", structuredOutput: { reply: { kind: "uncertainty" } } }));
  const record = vi.fn(async (event: AgentDiagnosticEvent) => { if (event.phase === "execution") throw new Error("PRIVATE_SINK_FAILURE"); });
  const result = await application(invoke, record).run();
  expect(result.status).toBe("completed");
  expect(invoke).toHaveBeenCalledOnce();
  expect(result).not.toHaveProperty("stopReason");
  expect(result).not.toHaveProperty("counts");
});

class MeteredDiagnosticModel extends Model<BaseModelConfig> {
  calls = 0;
  private config: BaseModelConfig = { modelId: "synthetic-diagnostic" };
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    if (++this.calls > 2) throw new Error("Output cap must stop before another model call");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: "read_place", toolUseId: `metered-${this.calls}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: "{}" } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
    yield { type: "modelMetadataEvent", usage: { inputTokens: 100, outputTokens: 2400, totalTokens: 2500 } };
  }
}

it("actual SDK usage reaches the Conversation diagnostic sink and CLI on a failed turn, never history", async () => {
  const model = new MeteredDiagnosticModel(), state = stateDynamoFixture(), trips = tripDynamoFixture();
  const { tripId: _tripId, ...metadata } = stateMetadata();
  await state.conversations.create(stateA, conversationId, metadata);
  const record = vi.fn(async (_event: AgentDiagnosticEvent) => undefined);
  const engine = new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1", systemPrompt: "test",
    maxTurns: 10, maxOutputTokens: 4096 }, { model });
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips",
    stateClient: state.client, tripClient: trips.client, diagnostics: { record }, newExecutionId: () => "test-execution",
    model: { converse: vi.fn(async () => { throw new Error("V1 must not run"); }) }, weather: { search: vi.fn() },
    runRuntime: createStrandsServerRuntime(engine), limits: { maxIterations: 10, maxModelCalls: 14, maxToolCalls: 16, maxExecutionMs: 150000 },
    registerAdditionalTools: tools => { tools.register({ name: "read_place", description: "Test read", effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, parseInput: () => validAgentToolInput({}),
      execute: async () => successfulAgentToolResult({ available: true }) }); },
  });
  await expect(app.runConversationTurn({ principal: stateA, conversationId,
    turnId: "73500000-0000-4000-8000-000000000001", userRequest: "PRIVATE_REQUEST" })).rejects.toThrow("limit_reached");
  const events = record.mock.calls.map(([event]) => event), executions = events.filter(event => event.phase === "execution");
  expect(executions).toHaveLength(1);
  expect(executions[0]).toMatchObject({ reason: "output_token_budget", stopReason: "limitOutputTokens", incomplete: true,
    counts: { modelCalls: 2, toolCalls: 2, inputTokens: 200, outputTokens: 4800, totalTokens: 5000 } });
  expect(model.calls).toBe(2);
  expect(JSON.stringify(events)).not.toContain("PRIVATE_REQUEST");
  const history = await state.conversations.history(stateA, conversationId);
  expect(history.items).toHaveLength(1);
  expect(JSON.stringify(history)).not.toContain("limitOutputTokens");
  expect(JSON.stringify(history)).not.toContain("modelCalls");
  const directory = mkdtempSync(join(tmpdir(), "sdk-diagnostic-"));
  try {
    const diagnostics = join(directory, "diagnostics.json"), streams = join(directory, "streams.json");
    writeFileSync(diagnostics, JSON.stringify(events.map(event => JSON.stringify({ event: "agent_diagnostic", ...event }))));
    writeFileSync(streams, "[]");
    const summary = execFileSync(process.execPath, [new URL("../../../../tools/deployment/summarize-agent-diagnostics.mjs", import.meta.url).pathname,
      diagnostics, streams], { encoding: "utf8" });
    expect(summary).toContain("output_token_budget | limitOutputTokens | - | 1 | 2 (1/1) | 2 (1/1) | 200 (1/1) | 4800 (1/1) | 5000 (1/1)");
    expect(summary).not.toContain("test-execution");
    expect(summary).not.toContain("PRIVATE_REQUEST");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
