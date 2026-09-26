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
  readonly toolChoices: StreamOptions["toolChoice"][] = [];
  constructor(private readonly replies: Reply[]) { super(); }
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(_messages: Message[], options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.toolChoices.push(options?.toolChoice);
    const reply = this.replies[this.index++];
    if (!reply) throw new Error("Unexpected extra model invocation");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if ("tool" in reply) {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: reply.tool, toolUseId: `tool-${this.index}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(reply.tool === "strands_structured_output" ? { reply: reply.input } : reply.input) } };
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
const submitted: Reply = { tool: "strands_structured_output", input: { kind: "uncertainty" } };
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
    const model = new ScriptedModel([lookup, submitted, end]);
    const result = await new StrandsAgentEngine(options, { model }).run(input);
    expect(result.stopReason).toBe("toolUse");
    expect(result.replyProposal).toEqual({ kind: "uncertainty" });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.trace.events.some(({ type }) => type === "tool_completed")).toBe(true);
    expect(model.toolChoices).toHaveLength(2); // No model request after the structured result.
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
    // The SDK supplies its own output Tool; no Application reply or Domain write Tool is registered.
    expect(captured?.tools).toHaveLength(0);
    expect(captured?.structuredOutputSchema).toBeDefined();
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
      { tool: "strands_structured_output", input: { kind: "unavailable", operation: "save" } },
      { text: "<thinking>DO_NOT_EXPOSE_REASONING_705</thinking>保存しておきます。" },
    ]) }).run(input);
    expect(result.replyProposal).toEqual({ kind: "unavailable", operation: "save" });
    expect(JSON.stringify(result)).not.toContain("DO_NOT_EXPOSE_REASONING_705");
    expect(JSON.stringify(result)).not.toContain("<thinking>");
    expect(JSON.stringify(result)).not.toContain("保存しておきます");
    expect(result).not.toHaveProperty("response");
  });
  it("does not convert an unstructured model answer into a reply proposal when a noncompliant model ignores ToolChoice", async () => {
    const { input } = setup();
    const model = new ScriptedModel([{ text: "保存しておきます。" }, { text: "保存しておきます。" }]);
    await expect(new StrandsAgentEngine(options, { model }).run(input)).rejects.toMatchObject({ stage: "runtime_projection", kind: "validation" });
    expect(model.toolChoices).toHaveLength(2); // The SDK owns the single forced-output attempt.
  });
  it("does not execute more Domain Tools after the reply has been submitted", async () => {
    const { execute, input } = setup();
    await new StrandsAgentEngine(options, { model: new ScriptedModel([submitted, lookup, end]) }).run(input);
    expect(execute).not.toHaveBeenCalled();
  });


  it("uses an Application-accepted intent update for later read Tool validation in the same Strands loop", async () => {
    const { execute, input } = setup();
    const update: Reply = { tool: "set_destination", input: { place: "神戸", quote: "神戸" } };
    const lookupKobe: Reply = { tool: "lookup_place", input: { location: "神戸" } };
    const apply = vi.fn(async () => ({
      receipt: { version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "correct" as const,
        outcome: "accepted" as const, changes: [{ changeRef: "change-1", groupRef: "group-1", action: "replace" as const,
          target: "destination" as const, scope: { type: "conversation" as const }, frame: "actual" as const, status: "accepted" as const }] },
      effectiveIntent: { ...effectiveDestination("神戸"), intentRevision: 4, fingerprint: "effective-kobe" },
    }));
    const result = await new StrandsAgentEngine(options, {
      model: new ScriptedModel([update, lookupKobe, submitted, end]),
    }).run({ ...input, userRequest: "行き先は神戸に変更", conditionController: { apply } });

    expect(apply).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(result.replyProposal).toEqual({ kind: "uncertainty" });
  });

  it("lets independent condition Tools use the same Application without an invocation-wide limiter", async () => {
    const { input } = setup();
    const apply = vi.fn(async () => ({ receipt: {
      version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "inform" as const,
      outcome: "accepted" as const, changes: [],
    }, effectiveIntent: effectiveDestination("京都") }));
    await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "set_destination", input: { place: "京都", quote: "京都" } },
      { tool: "set_origin", input: { place: "大阪", quote: "大阪" } },
      submitted,
    ]) }).run({ ...input, conditionController: { apply } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith({ target: "destination", place: "京都", quote: "京都" });
    expect(apply).toHaveBeenCalledWith({ target: "origin", place: "大阪", quote: "大阪" });
  });
});
