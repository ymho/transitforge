import { describe, expect, it, vi } from "vitest";
import { Model, type AgentConfig, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { StrandsAgentEngine, type StrandsAgentFactory } from "./strands-agent-engine.js";
import { strandsAnswerText } from "./strands-answer-text.js";

type Reply = { text: string } | { tool: string; input: Record<string, string> };
class ScriptedModel extends Model<BaseModelConfig> {
  private index = 0;
  private config: BaseModelConfig = { modelId: "synthetic" };
  constructor(private readonly replies: Reply[]) { super(); }
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(_messages: Message[], _options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    const reply = this.replies[this.index++];
    if (!reply) throw new Error("Unexpected extra model invocation");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if ("tool" in reply) {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: reply.tool, toolUseId: `tool-${this.index}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(reply.input) } };
    } else {
      yield { type: "modelContentBlockStartEvent" };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: reply.text } };
    }
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "tool" in reply ? "toolUse" : "endTurn" };
  }
}
const options = { modelId: "unused", region: "ap-northeast-1", systemPrompt: "Use available tools for facts.", maxTurns: 4 };
const lookup: Reply = { tool: "lookup_place", input: { location: "京都" } };
const answer: Reply = { text: "京都の情報を確認しました。" };
function effectiveDestination(label: string): EffectiveIntent {
  return {
    version: 1, base: { source: "none", fingerprint: "base" }, intentRevision: 3,
    activeBaseFacts: [], profileHints: [], ignoredProfileSettings: [], hypotheticalFacts: [],
    retractions: [], suppressedBaseRefs: [], profileSuppressions: [], fingerprint: "effective",
    actualConversationFacts: [{ factId: "destination", target: "destination", scope: { type: "conversation" },
      modality: "preferred", precision: "exact", value: { kind: "place_label", label }, frame: "actual",
      sourceOperationId: "destination-op", provenance: { kind: "user_turn", turnId: "00000000-0000-4000-8000-000000000001", quote: label } }],
  };
}
function setup(effect: "read" | "proposal" = "read") {
  const tools = new AgentToolRegistry();
  const execute = vi.fn(async () => successfulAgentToolResult({ name: "京都" }));
  tools.register({ name: "lookup_place", description: "場所を確認する", effect,
    inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"], additionalProperties: false },
    intentPolicy: { dependencies: ["destination"], requirements: [{ target: "destination", inputField: "location", necessity: "required", match: "exact" }] },
    parseInput: (value: unknown) => validAgentToolInput(value as { location: string }), execute });
  return { execute, input: { executionId: "v2-test", userRequest: "京都について教えて", tools,
    toolExecutor: new AgentToolExecutor(tools, new ToolEvidenceRegistry()), effectiveIntent: effectiveDestination("京都") } };
}

describe("StrandsAgentEngine", () => {
  it("runs a real Strands model-tool-model loop through the existing Tool executor", async () => {
    const { execute, input } = setup();
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([lookup, answer]) }).run(input);
    expect(result.stopReason).toBe("endTurn");
    expect(result.response).toBe("京都の情報を確認しました。");
    expect(execute).toHaveBeenCalledOnce();
    expect(result.trace.events.some(({ type }) => type === "tool_completed")).toBe(true);
  });
  it("rejects stale model Tool input before the Domain Tool executes", async () => {
    const { execute, input } = setup();
    await new StrandsAgentEngine(options, { model: new ScriptedModel([lookup, answer]) })
      .run({ ...input, effectiveIntent: effectiveDestination("神戸") });
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not expose proposal Tools in the initial Strands slice", async () => {
    const { input } = setup("proposal");
    const configs: AgentConfig[] = [];
    const createAgent: StrandsAgentFactory = (config) => {
      configs.push(config);
      return { invoke: async () => ({ stopReason: "endTurn",
        lastMessage: { role: "assistant", content: [{ type: "textBlock", text: "回答候補" }] },
        toString: () => { throw new Error("Must not stringify the SDK result"); } }) };
    };
    await new StrandsAgentEngine(options, { createAgent }).run(input);
    expect(configs[0]?.tools).toHaveLength(0);
    const model = configs[0]?.model as { getConfig(): { stream?: boolean } };
    expect(model.getConfig().stream).toBe(false);
  });
  it("stops additional Tool side effects after the per-turn Tool budget is exhausted", async () => {
    const { execute, input } = setup();
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([lookup, lookup, answer]) })
      .run({ ...input, limits: { maxToolCalls: 1, maxTurns: 4 } });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.limitReason).toBe("tool_calls");
  });
  it("marks the invocation as deadline-limited when the Strands invocation is cancelled by its deadline", async () => {
    const { input } = setup();
    const createAgent: StrandsAgentFactory = () => ({ invoke: async (_request, invokeOptions) => {
      await new Promise<void>((resolve) => {
        if (invokeOptions?.cancelSignal?.aborted) return resolve();
        invokeOptions?.cancelSignal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return { stopReason: "cancelled" };
    } });
    const result = await new StrandsAgentEngine(options, { createAgent }).run({ ...input, limits: { maxExecutionMs: 5 } });
    expect(result.response).toBe("");
    expect(result.limitReason).toBe("deadline");
  });
  it("rejects provider thought markup rather than publishing or repairing it", async () => {
    const { input } = setup();
    await expect(new StrandsAgentEngine(options, { model: new ScriptedModel([{ text: "<thinking>private</thinking>京都です" }]) })
      .run(input)).rejects.toMatchObject({ name: "StrandsAnswerTextError", code: "internal_content" });
  });
});

describe("Strands answer text boundary", () => {
  const result = (content: unknown[]) => ({ lastMessage: { role: "assistant", content } });
  it("extracts only assistant text and never reasoning, signatures, or debug output", () => {
    expect(strandsAnswerText(result([{ type: "reasoningBlock", text: "private", signature: "private" },
      { type: "textBlock", text: "公開する本文" }]))).toBe("公開する本文");
  });
  it("does not fall back to stringification or accept reasoning-only results", () => {
    expect(() => strandsAnswerText({})).toThrow();
    expect(() => strandsAnswerText(result([{ type: "reasoningBlock", text: "private" }]))).toThrow();
  });
  it("rejects tool payloads and thought markup inside ordinary text", () => {
    expect(() => strandsAnswerText(result([{ type: "toolUseBlock", input: { secret: "private" } }]))).toThrow();
    for (const text of ["<thinking>private</thinking>本文", "<analysis>private", "💭 Reasoning: private"]) {
      expect(() => strandsAnswerText(result([{ type: "textBlock", text }]))).toThrow();
    }
  });
  it("preserves ordinary text without truncating oversized answers into success", () => {
    expect(strandsAnswerText(result([{ type: "textBlock", text: "一行目" }, { type: "textBlock", text: "二行目" }]))).toBe("一行目\n二行目");
    expect(() => strandsAnswerText(result([{ type: "textBlock", text: "x".repeat(12_001) }]))).toThrow();
  });
});
