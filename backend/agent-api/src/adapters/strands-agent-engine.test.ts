import { describe, expect, it, vi } from "vitest";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { ConditionUpdateRejectedError } from "@raiquora/agent/conversation-condition";
import { BedrockModel, Model, type AgentConfig, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
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
  readonly observedMessages: string[] = [];
  constructor(private readonly replies: Reply[]) { super(); }
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(_messages: Message[], options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    this.toolChoices.push(options?.toolChoice);
    this.observedMessages.push(JSON.stringify(_messages));
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
function setup(effect: "read" | "proposal" = "read", agentV2Proposal = false) {
  const tools = new AgentToolRegistry();
  const execute = vi.fn(async () => successfulAgentToolResult({ name: "京都" }));
  tools.register({ name: "lookup_place", description: "場所を確認する", effect,
    ...(agentV2Proposal ? { requiredCapabilities: ["agent-v2-proposal"] } : {}),
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
  it.each(["explore_destination", "discover_destinations"])(
    "keeps %s research internals out of the model reply contract while preserving Evidence", async name => {
      const tools = new AgentToolRegistry(), registry = new ToolEvidenceRegistry();
      const evidence: Evidence = { id: "verified-page", category: "external", knowledgeKind: "deterministic_fact",
        subject: "合成神社", facts: { sourceExcerpt: "合成神社の由来を紹介しています。" },
        references: [{ sourceType: "external-source", sourceRef: "https://example.test/shrine",
          retrievedAt: "2026-09-29T00:00:00Z", freshness: "current", summary: "合成資料" }] };
      const discovery: Evidence = { ...evidence, id: "discovery-only", knowledgeKind: "unverified_information" };
      const outcome = { status: "partial", verifiedCandidateCount: 1, photoCandidateCount: 0,
        completedScopes: ["verified_sources"], failedScopes: ["place_photos"] };
      tools.register({ name, description: "旅行先を調べる", effect: "read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        parseInput: () => validAgentToolInput({}), execute: async () => successfulAgentToolResult({
          outcome, discovery: { internal: "research-state" }, webPages: { internal: "page-state" },
          candidateAssessments: ["assessment-state"], result: { internal: "provider-state" },
        }) });
      registry.register(name, () => [discovery, evidence]);
      const model = new ScriptedModel([{ tool: name, input: {} }, submitted]);
      const result = await new StrandsAgentEngine(options, { model }).run({ executionId: "research-contract",
        userRequest: "旅先の魅力を教えて", tools, toolExecutor: new AgentToolExecutor(tools, registry) });
      const toolResult = JSON.parse(model.observedMessages[1]!).at(-1).content[0].toolResult.content[0].json;
      expect(toolResult.output).toEqual({ outcome });
      expect(toolResult.replyReferences).toEqual([{ reference: { evidenceId: evidence.id, field: "sourceExcerpt" }, value: evidence.facts.sourceExcerpt }]);
      expect(model.observedMessages[1]).not.toContain("research-state");
      expect(result.evidence.map(item => item.id)).toEqual([discovery.id, evidence.id]);
    });

  it.each([undefined, "low"] as const)(
    "uses only explicitly configured Nova reasoning: %s", async novaReasoningEffort => {
      const { input } = setup();
      let captured: ReturnType<BedrockModel["getConfig"]> = {};
      const createAgent: StrandsAgentFactory = config => {
        if (!(config.model instanceof BedrockModel)) throw new Error("Expected Bedrock model");
        captured = config.model.getConfig();
        return { invoke: async () => ({ stopReason: "toolUse", structuredOutput: { reply: { kind: "uncertainty" } } }) };
      };
      await new StrandsAgentEngine({ ...options, novaReasoningEffort, maxOutputTokens: 4096 }, { createAgent }).run(input);
      expect(captured.additionalRequestFields).toEqual(novaReasoningEffort
        ? { reasoningConfig: { type: "enabled", maxReasoningEffort: "low" } } : undefined);
      expect(captured.maxTokens).toBe(4096);
      expect(captured.stream).toBe(false);
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
  it("exposes only an explicitly opted-in Agent v2 proposal capability", async () => {
    const { execute, input } = setup("proposal", true);
    let captured: AgentConfig | undefined;
    const createAgent: StrandsAgentFactory = (config) => {
      captured = config;
      return { invoke: async () => ({ stopReason: "endTurn", lastMessage: { role: "assistant", content: [] } }) };
    };
    await new StrandsAgentEngine(options, { createAgent }).run(input);
    expect(captured?.tools).toHaveLength(1);
    expect((captured?.tools?.[0] as { name?: string })?.name).toBe("lookup_place");
    expect(execute).not.toHaveBeenCalled();
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
    const update: Reply = { tool: "update_current_destination", input: { action: "set", place: "神戸", quote: "神戸" } };
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

  it("delegates repeated commands to Application rather than owning durable-write deduplication", async () => {
    const { input } = setup();
    const apply = vi.fn(async () => ({
      receipt: { version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "inform" as const,
        outcome: "accepted" as const, changes: [] },
      effectiveIntent: { ...effectiveDestination("出雲大社"), intentRevision: 4, fingerprint: "effective-izumo" },
    }));
    const repeated = { tool: "update_current_destination", input: { action: "set", place: "出雲大社", quote: "出雲大社に行きたい" } } as const;
    const result = await new StrandsAgentEngine(options, {
      model: new ScriptedModel([repeated, repeated, submitted]),
    }).run({ ...input, userRequest: "出雲大社に行きたい", conditionController: { apply } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(result.effectiveIntent?.fingerprint).toBe("effective-izumo");
    expect(result.replyProposal).toEqual({ kind: "uncertainty" });
  });

  it("represents a correction as one final-state update instead of clear then set", async () => {
    const { input } = setup();
    const apply = vi.fn(async () => ({ receipt: {
      version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "correct" as const,
      outcome: "accepted" as const, changes: [],
    }, effectiveIntent: effectiveDestination("神戸") }));
    await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "update_current_destination", input: { action: "set", place: "神戸", quote: "神戸に変更" } },
      submitted,
    ]) }).run({ ...input, userRequest: "神戸に変更", conditionController: { apply } });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({ target: "destination", place: "神戸", quote: "神戸に変更" });
  });

  it("uses one party Tool without guessing an adult/child split for a total-only party", async () => {
    const { input } = setup();
    const apply = vi.fn(async () => ({ receipt: {
      version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "inform" as const,
      outcome: "accepted" as const, changes: [],
    }, effectiveIntent: effectiveDestination("京都") }));
    await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "update_current_party", input: { action: "set", party: { kind: "count", people: 2 }, quote: "2人で" } },
      submitted,
    ]) }).run({ ...input, userRequest: "2人で京都へ行きたい", conditionController: { apply } });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({ target: "party_size", party: { kind: "count", people: 2 }, quote: "2人で" });
  });

  it("keeps a hypothetical party scenario out of the durable condition controller", async () => {
    const { input } = setup();
    const apply = vi.fn();
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "consider_trip_scenario", input: { party: { kind: "count", people: 4 }, quote: "もし4人なら" } },
      submitted,
    ]) }).run({ ...input, userRequest: "もし4人ならどうなる？今の人数は変えずに比較したい", conditionController: { apply } });
    expect(apply).not.toHaveBeenCalled();
    expect(result.effectiveIntent).toEqual(input.effectiveIntent);
    expect(result.replyProposal).toEqual({ kind: "uncertainty" });
  });

  it("sends one travel-period command to Application instead of separate date writers", async () => {
    const { input } = setup();
    const apply = vi.fn(async () => ({ receipt: {
      version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "inform" as const,
      outcome: "accepted" as const, changes: [],
    }, effectiveIntent: effectiveDestination("京都") }));
    await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "update_current_travel_period", input: { action: "set", period: {
        start: { kind: "calendar_date", month: 10, day: 3 },
        end: { kind: "calendar_date", day: 5 },
      }, quote: "10月3日から5日まで" } },
      submitted,
    ]) }).run({ ...input, userRequest: "10月3日から5日まで旅行します", conditionController: { apply } });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({ target: "travel_period", period: {
      start: { kind: "calendar_date", month: 10, day: 3 },
      end: { kind: "calendar_date", day: 5 },
    }, quote: "10月3日から5日まで" });
  });

  it("sends one budget command to Application without model-owned persistence metadata", async () => {
    const { input } = setup();
    const apply = vi.fn(async () => ({ receipt: {
      version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "inform" as const,
      outcome: "accepted" as const, changes: [],
    }, effectiveIntent: effectiveDestination("京都") }));
    await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "update_current_budget", input: { action: "set",
        budget: { amount: 50000, currency: "JPY", basis: "per_person" }, quote: "1人5万円くらい" } },
      submitted,
    ]) }).run({ ...input, userRequest: "予算は1人5万円くらい", conditionController: { apply } });
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({ target: "budget",
      budget: { amount: 50000, currency: "JPY", basis: "per_person" }, quote: "1人5万円くらい" });
  });

  it("keeps a hypothetical budget out of the durable condition controller", async () => {
    const { input } = setup();
    const apply = vi.fn();
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "consider_trip_scenario", input: { kind: "budget",
        budget: { amount: 200000, currency: "JPY", basis: "trip" }, quote: "もし20万円なら" } },
      submitted,
    ]) }).run({ ...input, userRequest: "もし20万円ならどう？今の予算は変えない", conditionController: { apply } });
    expect(apply).not.toHaveBeenCalled();
    expect(result.effectiveIntent).toEqual(input.effectiveIntent);
  });

  it("lets independent condition Tools use the same Application without an invocation-wide limiter", async () => {
    const { input } = setup();
    const apply = vi.fn(async () => ({ receipt: {
      version: "public-semantic-receipt-v1" as const, intentRevision: 4, speechAct: "inform" as const,
      outcome: "accepted" as const, changes: [],
    }, effectiveIntent: effectiveDestination("京都") }));
    await new StrandsAgentEngine(options, { model: new ScriptedModel([
      { tool: "update_current_destination", input: { action: "set", place: "京都", quote: "京都" } },
      { tool: "update_current_origin", input: { action: "set", place: "大阪", quote: "大阪" } },
      submitted,
    ]) }).run({ ...input, conditionController: { apply } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith({ target: "destination", place: "京都", quote: "京都" });
    expect(apply).toHaveBeenCalledWith({ target: "origin", place: "大阪", quote: "大阪" });
  });
});

describe("independent model and invocation output limits", () => {
  it("does not silently use a per-model cap as the cumulative SDK cap", async () => {
    const { input } = setup();
    let modelLimit: number | undefined, invocation: unknown;
    const createAgent: StrandsAgentFactory = config => {
      modelLimit = (config.model as { getConfig(): { maxTokens?: number } }).getConfig().maxTokens;
      return { invoke: async (_value, opts) => { invocation = opts?.limits;
        return { stopReason: "toolUse", structuredOutput: { reply: { kind: "uncertainty", text: "未確認の点を説明します。" } } }; } };
    };
    const result = await new StrandsAgentEngine({ ...options, maxOutputTokens: 1024 }, { createAgent }).run(input);
    expect(modelLimit).toBe(1024);
    expect(invocation).not.toHaveProperty("outputTokens");
    expect(result.replyProposal?.kind).toBe("uncertainty");
    await new StrandsAgentEngine({ ...options, maxOutputTokens: 1024, maxInvocationOutputTokens: 4096 }, { createAgent }).run(input);
    expect(modelLimit).toBe(1024);
    expect(invocation).toMatchObject({ outputTokens: 4096 });
    await new StrandsAgentEngine({ ...options, maxOutputTokens: 1024, maxInvocationOutputTokens: 4096 }, { createAgent })
      .run({ ...input, limits: { maxOutputTokens: 2048 } });
    expect(invocation).toMatchObject({ outputTokens: 2048 });
  });
});


// These are Adapter contract tests using the real SDK and a synthetic model.
// They do not assert that the live model stops repeating or that Trip is saved.
describe("condition authority remains in Application (#761)", () => {
  const command = (place: string | null): Reply => ({ tool: "update_current_destination", input: {
    action: place === null ? "clear" : "set", ...(place === null ? {} : { place }), quote: place ?? "行き先は未定に戻す",
  } });
  const accepted = (label: string, revision: number) => ({ receipt: {
    version: "public-semantic-receipt-v1" as const, intentRevision: revision, speechAct: "correct" as const,
    outcome: "accepted" as const, changes: [],
  }, effectiveIntent: { ...effectiveDestination(label), intentRevision: revision, fingerprint: `accepted-${revision}` } });

  it("uses a second Application-accepted value for subsequent reads rather than returning fake success", async () => {
    const { input, execute } = setup();
    const apply = vi.fn().mockResolvedValueOnce(accepted("京都", 4)).mockResolvedValueOnce(accepted("神戸", 5));
    const model = new ScriptedModel([command("京都"), command("神戸"),
      { tool: "lookup_place", input: { location: "神戸" } }, submitted]);
    const result = await new StrandsAgentEngine(options, { model }).run({ ...input, conditionController: { apply } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(2, { target: "destination", place: "神戸", quote: "神戸" });
    expect(execute).toHaveBeenCalledOnce();
    expect(result.effectiveIntent?.fingerprint).toBe("accepted-5");
    expect(model.observedMessages.join("\n")).not.toContain("already_applied_this_turn");
  });

  it("delegates the clear operation to Application after an accepted set", async () => {
    const { input } = setup();
    const cleared = accepted("京都", 5);
    cleared.effectiveIntent.actualConversationFacts = [];
    const apply = vi.fn().mockResolvedValueOnce(accepted("京都", 4)).mockResolvedValueOnce(cleared);
    const result = await new StrandsAgentEngine(options, { model: new ScriptedModel([command("京都"), command(null), submitted]) })
      .run({ ...input, conditionController: { apply } });
    expect(apply).toHaveBeenNthCalledWith(2, { target: "destination", place: null, quote: "行き先は未定に戻す" });
    expect(result.effectiveIntent?.actualConversationFacts).toEqual([]);
  });

  it("surfaces an Application conflict instead of telling the model the second request was applied", async () => {
    const { input } = setup();
    const apply = vi.fn().mockResolvedValueOnce(accepted("京都", 4))
      .mockRejectedValueOnce(new ConditionUpdateRejectedError("condition_conflict"));
    const model = new ScriptedModel([command("京都"), command("神戸"), submitted]);
    const result = await new StrandsAgentEngine(options, { model }).run({ ...input, conditionController: { apply } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(result.effectiveIntent?.fingerprint).toBe("accepted-4");
    expect(model.observedMessages.at(-1)).toContain("condition_conflict");
    expect(model.observedMessages.at(-1)).not.toContain("already_applied_this_turn");
  });

  it("does not hide an uncertain second write and blocks both later reads and reply publication", async () => {
    const { input, execute } = setup();
    const apply = vi.fn().mockResolvedValueOnce(accepted("京都", 4)).mockRejectedValueOnce(new Error("storage unavailable"));
    const model = new ScriptedModel([command("京都"), command("神戸"), lookup, submitted]);
    await expect(new StrandsAgentEngine(options, { model }).run({ ...input, conditionController: { apply } }))
      .rejects.toMatchObject({ stage: "intent_state", kind: "unknown" });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows another grounded command after a definite rejection without caching that rejection", async () => {
    const { input } = setup();
    const apply = vi.fn().mockRejectedValueOnce(new ConditionUpdateRejectedError("invalid_source"))
      .mockResolvedValueOnce(accepted("神戸", 4));
    const model = new ScriptedModel([command("京都"), command("神戸"), submitted]);
    const result = await new StrandsAgentEngine(options, { model }).run({ ...input, conditionController: { apply } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(result.effectiveIntent?.fingerprint).toBe("accepted-4");
    expect(model.observedMessages.at(-1)).toContain("invalid_source");
  });
});
