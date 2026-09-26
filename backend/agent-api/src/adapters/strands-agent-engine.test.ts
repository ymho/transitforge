import { describe, expect, it, vi } from "vitest";
import { Model, type AgentConfig, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { StrandsAgentEngine, type StrandsAgentFactory } from "./strands-agent-engine.js";

type Reply = { text: string } | { tool: string; input: Record<string, unknown> };
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
const submitted: Reply = { tool: "submit_reply", input: { kind: "uncertainty" } };
const end: Reply = { text: "終了しました。" };
function effectiveDestination(label: string): EffectiveIntent {
  return { version: 1, base: { source: "none", fingerprint: "base" }, intentRevision: 3,
    activeBaseFacts: [], profileHints: [], ignoredProfileSettings: [], hypotheticalFacts: [],
    retractions: [], suppressedBaseRefs: [], profileSuppressions: [], fingerprint: "effective",
    actualConversationFacts: [{ factId: "destination", target: "destination", scope: { type: "conversation" },
      modality: "preferred", precision: "exact", value: { kind: "place_label", label }, frame: "actual",
      sourceOperationId: "destination-op", provenance: { kind: "user_turn", turnId: "00000000-0000-4000-8000-000000000001", quote: label } }] };
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
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([lookup, submitted, end]) }).run(input);
    expect(result.stopReason).toBe("endTurn");
    expect(result.replyProposal).toEqual({ kind: "uncertainty" });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.trace.events.some(({ type }) => type === "tool_completed")).toBe(true);
  });
  it("rejects stale model Tool input before the Domain Tool executes", async () => {
    const { execute, input } = setup();
    await new StrandsAgentEngine(options, { model: new ScriptedModel([lookup, submitted, end]) })
      .run({ ...input, effectiveIntent: effectiveDestination("神戸") });
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not expose proposal Tools in the initial Strands slice", async () => {
    const { execute, input } = setup("proposal");
    let captured: AgentConfig | undefined;
    const createAgent: StrandsAgentFactory = (config) => {
      captured = config;
      return { invoke: async () => ({ stopReason: "endTurn", lastMessage: { role: "assistant", content: [] } }) };
    };
    await new StrandsAgentEngine(options, { createAgent }).run(input);
    // The only Tool is a local reply submission; there are no Domain write/proposal Tools.
    expect(captured?.tools).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
    expect((captured?.model as { getConfig(): { stream?: boolean } }).getConfig().stream).toBe(false);
  });
  it("stops additional Tool side effects after the per-turn Tool budget is exhausted", async () => {
    const { execute, input } = setup();
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([lookup, lookup, submitted, end]) })
      .run({ ...input, limits: { maxToolCalls: 1 } });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.limitReason).toBe("tool_calls");
  });
  it("marks the invocation as deadline-limited when the Strands invocation is cancelled by its deadline", async () => {
    const { input } = setup();
    const createAgent: StrandsAgentFactory = () => ({ invoke: async (_args, options) => {
      await new Promise<void>((resolve) => {
        if (options?.cancelSignal?.aborted) return resolve();
        options?.cancelSignal?.addEventListener("abort", () => resolve(), { once: true });
      });
      return { stopReason: "cancelled" };
    } });
    const result = await new StrandsAgentEngine(options, { createAgent }).run({ ...input, limits: { maxExecutionMs: 5 } });
    expect(result.stopReason).toBe("cancelled");
    expect(result.limitReason).toBe("deadline");
  });
  it("does not publish last-message prose, reasoning, or a false promise after a valid submission", async () => {
    const { input } = setup();
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "submit_reply", input: { kind: "unavailable", operation: "save" } },
      { text: "<thinking>private</thinking>保存しておきます。" },
    ]) }).run(input);
    expect(result.replyProposal).toEqual({ kind: "unavailable", operation: "save" });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("保存しておきます");
    expect(result).not.toHaveProperty("response");
  });
  it("does not convert an unstructured model answer into a reply proposal", async () => {
    const { input } = setup();
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([{ text: "保存しておきます。" }]) }).run(input);
    expect(result.replyProposal).toBeUndefined();
  });
  it("does not execute more Domain Tools after the reply has been submitted", async () => {
    const { execute, input } = setup();
    await new StrandsAgentEngine(options, { model: new ScriptedModel([submitted, lookup, end]) }).run(input);
    expect(execute).not.toHaveBeenCalled();
  });
});
