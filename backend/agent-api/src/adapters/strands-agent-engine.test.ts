import { describe, expect, it, vi } from "vitest";
import {
  Model,
  type BaseModelConfig,
  type Message,
  type ModelStreamEvent,
  type StreamOptions,
} from "@strands-agents/sdk";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { StrandsAgentEngine } from "./strands-agent-engine.js";

class TwoTurnToolModel extends Model<BaseModelConfig> {
  private calls = 0;
  private config: BaseModelConfig = { modelId: "test-model" };

  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }

  async *stream(_messages: Message[], _options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.calls += 1;
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (this.calls === 1) {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: "lookup_place", toolUseId: "tool-1" } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify({ location: "京都" }) } };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
      return;
    }
    yield { type: "modelContentBlockStartEvent" };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "京都の情報を確認しました。" } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
  }
}

class TwoToolThenAnswerModel extends Model<BaseModelConfig> {
  private calls = 0;
  private config: BaseModelConfig = { modelId: "test-model" };
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(_messages: Message[], _options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.calls += 1;
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (this.calls <= 2) {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: "lookup_place", toolUseId: `tool-${this.calls}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify({ location: "京都" }) } };
      yield { type: "modelContentBlockStopEvent" };
      yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
      return;
    }
    yield { type: "modelContentBlockStartEvent" };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "完了" } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "endTurn" };
  }
}

function effectiveDestination(label: string): EffectiveIntent {
  return {
    version: 1,
    base: { source: "none", fingerprint: "base" },
    intentRevision: 3,
    activeBaseFacts: [],
    profileHints: [],
    ignoredProfileSettings: [],
    actualConversationFacts: [{
      factId: "fact-destination",
      target: "destination",
      scope: { type: "conversation" },
      modality: "preferred",
      precision: "exact",
      value: { kind: "place_label", label },
      frame: "actual",
      sourceOperationId: "operation-destination",
      provenance: { kind: "user_turn", turnId: "00000000-0000-4000-8000-000000000001", quote: label },
    }],
    hypotheticalFacts: [],
    retractions: [],
    suppressedBaseRefs: [],
    profileSuppressions: [],
    fingerprint: "effective",
  };
}

function setupTool(execute = vi.fn(async () => successfulAgentToolResult({ name: "京都" }))) {
  const registry = new AgentToolRegistry();
  registry.register({
    name: "lookup_place",
    description: "場所を確認する",
    inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"], additionalProperties: false },
    effect: "read",
    intentPolicy: { dependencies: ["destination"], requirements: [
      { target: "destination", inputField: "location", necessity: "required", match: "exact" },
    ] },
    parseInput: (value: unknown) => validAgentToolInput(value as { location: string }),
    execute,
  });
  return { registry, executor: new AgentToolExecutor(registry, new ToolEvidenceRegistry()) };
}

describe("StrandsAgentEngine", () => {
  it("runs a real Strands model-tool-model loop through the existing Tool executor", async () => {
    const execute = vi.fn(async () => successfulAgentToolResult({ name: "京都" }));
    const { registry, executor } = setupTool(execute);
    const engine = new StrandsAgentEngine({
      modelId: "unused",
      region: "ap-northeast-1",
      systemPrompt: "Use tools for facts.",
      maxTurns: 4,
    }, { model: new TwoTurnToolModel() });

    const result = await engine.run({
      executionId: "execution-v2",
      userRequest: "京都について教えて",
      tools: registry,
      toolExecutor: executor,
      effectiveIntent: effectiveDestination("京都"),
    });

    expect(result.stopReason).toBe("endTurn");
    expect(result.response).toContain("京都の情報を確認しました");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.trace.events.some(({ type }) => type === "tool_completed")).toBe(true);
  });

  it("rejects stale model Tool input before the Domain Tool executes", async () => {
    const execute = vi.fn(async () => successfulAgentToolResult({ name: "大阪" }));
    const { registry, executor } = setupTool(execute);
    const engine = new StrandsAgentEngine({
      modelId: "unused",
      region: "ap-northeast-1",
      systemPrompt: "Use tools for facts.",
      maxTurns: 4,
    }, { model: new TwoTurnToolModel() });

    await engine.run({
      executionId: "execution-stale",
      userRequest: "大阪について教えて",
      tools: registry,
      toolExecutor: executor,
      effectiveIntent: effectiveDestination("神戸"),
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("does not expose proposal Tools in the initial Strands slice", async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: "propose_change",
      description: "変更案を作る",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      effect: "proposal",
      parseInput: (value: unknown) => validAgentToolInput(value as Record<string, never>),
      execute: async () => successfulAgentToolResult({ proposed: true }),
    });
    const executor = new AgentToolExecutor(registry, new ToolEvidenceRegistry());
    const agentFactory = vi.fn((_config) => ({
      id: "fake",
      invoke: async () => ({
        stopReason: "endTurn",
        lastMessage: { role: "assistant", content: [] },
        invocationState: {},
        toString: (): string => "ok",
      }),
      stream: async function* () { throw new Error("not used"); },
      name: undefined,
      description: undefined,
    }));
    const engine = new StrandsAgentEngine({
      modelId: "unused",
      region: "ap-northeast-1",
      systemPrompt: "test",
    }, { createAgent: agentFactory as never });

    await engine.run({ executionId: "execution-proposal", userRequest: "変更して", tools: registry, toolExecutor: executor });

    const config = agentFactory.mock.calls[0]?.[0];
    expect(config?.tools).toHaveLength(0);
    expect((config?.model as { getConfig(): { stream?: boolean; modelId?: string } }).getConfig())
      .toMatchObject({ modelId: "unused", stream: false });
  });

  it("stops additional Tool side effects after the per-turn Tool budget is exhausted", async () => {
    const execute = vi.fn(async () => successfulAgentToolResult({ name: "京都" }));
    const { registry, executor } = setupTool(execute);
    const engine = new StrandsAgentEngine({
      modelId: "unused", region: "ap-northeast-1", systemPrompt: "Use tools.", maxTurns: 4,
    }, { model: new TwoToolThenAnswerModel() });

    const result = await engine.run({
      executionId: "execution-budget",
      userRequest: "京都を確認して",
      tools: registry,
      toolExecutor: executor,
      effectiveIntent: effectiveDestination("京都"),
      limits: { maxToolCalls: 1, maxTurns: 4 },
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.limitReason).toBe("tool_calls");
  });

  it("marks the invocation as deadline-limited when the Strands invocation is cancelled by its deadline", async () => {
    const { registry, executor } = setupTool();
    const engine = new StrandsAgentEngine({
      modelId: "unused", region: "ap-northeast-1", systemPrompt: "test",
    }, { createAgent: () => ({
      id: "deadline-agent",
      async invoke(_args: string, options?: {
        cancelSignal?: AbortSignal;
        limits?: { turns?: number; totalTokens?: number; outputTokens?: number };
      }) {
        await new Promise<void>((resolve) => {
          if (options?.cancelSignal?.aborted) return resolve();
          options?.cancelSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { stopReason: "cancelled", toString: () => "" };
      },
      async *stream() { throw new Error("not used"); },
    }) as never });

    const result = await engine.run({
      executionId: "execution-deadline",
      userRequest: "期限テスト",
      tools: registry,
      toolExecutor: executor,
      limits: { maxExecutionMs: 5 },
    });

    expect(result.stopReason).toBe("cancelled");
    expect(result.limitReason).toBe("deadline");
  });
});
