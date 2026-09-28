import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BedrockModel, Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { AgentToolRegistry } from "@raiquora/agent/tool-registry";
import { AgentToolExecutor } from "@raiquora/agent/agent-tool-executor";
import { ToolEvidenceRegistry } from "@raiquora/agent/tool-evidence-registry";
import { successfulAgentToolResult, validAgentToolInput } from "@raiquora/agent/tool-contract";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createProductionServerAgent } from "../production-server-agent-composition.js";
import { stateDynamoFixture, conversationId } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";

type CompositionOptions = Parameters<typeof import("./conversation-server-agent.js").createConversationServerAgent>[0];
const isolated = vi.hoisted(() => ({
  stateClient: undefined as CompositionOptions["stateClient"],
  tripClient: undefined as CompositionOptions["tripClient"],
}));

// Keep the actual production factory, Tool inventory, Providers, prompt and budgets.
// Replace only personal state clients/tables and suppress application content logs.
// Any paid runner must additionally exclude real personal-state permissions.
vi.mock("./production-conversation-agent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./production-conversation-agent.js")>();
  return { ...actual, createProductionConversationAgent: (options: CompositionOptions) => {
    if (!isolated.stateClient || !isolated.tripClient) throw new Error("Fixture state is required");
    return actual.createProductionConversationAgent({ ...options,
      stateTable: "test-state", tripTable: "test-trips",
      stateClient: isolated.stateClient, tripClient: isolated.tripClient,
      diagnostics: { record: async () => undefined }, log: () => undefined,
    });
  } };
});

class MeteredModel extends Model<BaseModelConfig> {
  calls = 0;
  private config: BaseModelConfig = { modelId: "synthetic-metered-output" };
  updateConfig(config: BaseModelConfig) { this.config = { ...this.config, ...config }; }
  getConfig() { return this.config; }
  async *stream(_messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    const call = ++this.calls;
    if (call > 3) throw new Error("Unexpected model call after structured output");
    const name = call < 3 ? "read_place" : "strands_structured_output";
    const value = call < 3 ? {} : { reply: { kind: "uncertainty" } };
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name, toolUseId: `synthetic-${call}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(value) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
    const outputTokens = call < 3 ? 2400 : 100;
    yield { type: "modelMetadataEvent", usage: { inputTokens: 100, outputTokens, totalTokens: 100 + outputTokens } };
  }
}

it("measures the cumulative output cap separately from the unchanged per-call cap with the actual SDK", async () => {
  for (const cumulativeOutputTokens of [4096, 8192]) {
    const tools = new AgentToolRegistry(), evidence = new ToolEvidenceRegistry(), model = new MeteredModel();
    tools.register({ name: "read_place", description: "Synthetic deterministic read", effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      parseInput: () => validAgentToolInput({}), execute: async () => successfulAgentToolResult({ available: true }) });
    const engine = new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1",
      systemPrompt: "Return structured output.", maxTurns: 10, maxOutputTokens: 4096, maxInvocationOutputTokens: 4096 }, { model });
    const result = await engine.run({ executionId: "synthetic-output-budget", userRequest: "synthetic request", tools,
      toolExecutor: new AgentToolExecutor(tools, evidence),
      limits: { maxTurns: 10, maxToolCalls: 16, maxExecutionMs: 150000,
        ...(cumulativeOutputTokens === 8192 ? { maxOutputTokens: cumulativeOutputTokens } : {}) } });
    console.log(JSON.stringify({ event: "synthetic-output-cap", cumulativeOutputTokens,
      stopReason: result.stopReason, modelCalls: model.calls, metrics: result.metrics,
      replyPresent: result.replyProposal !== undefined }));
    expect(result.stopReason).toBe(cumulativeOutputTokens === 4096 ? "limitOutputTokens" : "toolUse");
    expect(model.calls).toBe(cumulativeOutputTokens === 4096 ? 2 : 3);
    expect(result.replyProposal !== undefined).toBe(cumulativeOutputTokens === 8192);
  }
});

const enabled = process.env.AGENT_V2_PRODUCTION_REPRO === "true";
const allowedStops = new Set(["endTurn", "toolUse", "stopSequence", "limitTurns", "limitTotalTokens", "limitOutputTokens", "maxTokens", "modelContextWindowExceeded", "cancelled"]);

describe.skipIf(!enabled)("one production-composed first turn with real Bedrock and travel Providers", () => {
  it("accepts the destination and publishes a useful first response without greeting or card hints", async () => {
    const path = process.env.REPRO_ENV_PATH;
    if (!path) throw new Error("Explicit allowlisted environment file is required");
    const environment: Record<string, string | undefined> = JSON.parse(readFileSync(path, "utf8"));
    expect(environment.AGENT_RUNTIME_V2_ENABLED).toBe("true");
    environment.SERVER_STATE_TABLE_NAME = "test-state";
    environment.TRIP_TABLE_NAME = "test-trips";
    const state = stateDynamoFixture(), trips = tripDynamoFixture();
    isolated.stateClient = state.client; isolated.tripClient = trips.client;
    const { verifier } = cognitoTokenFixture();
    const principal = await verifier.verify(token());

    const streamOriginal = BedrockModel.prototype.stream;
    let modelRound = 0;
    const streamObserver = vi.spyOn(BedrockModel.prototype, "stream").mockImplementation(async function* (this: BedrockModel, ...args) {
      const messages = JSON.parse(JSON.stringify(args[0]));
      const last = messages.at(-1);
      console.log(JSON.stringify({ event: "repro-model-input", round: ++modelRound,
        messageCount: messages.length, messageBytes: JSON.stringify(messages).length,
        lastResults: (last?.content ?? []).filter((block: any) => block.toolResult).map((block: any) => {
          const result = block.toolResult;
          return { status: result.status, content: (result.content ?? []).map((part: any) => {
            let value = part.json;
            if (!value && typeof part.text === "string") { try { value = JSON.parse(part.text); } catch {} }
            return value ? summarizeReproOutput(value) : { unparsedText: typeof part.text === "string",
              textLength: part.text?.length ?? 0, validationError: /validation|invalid|rejected/i.test(part.text ?? "") };
          }) };
        }) }));
      yield* streamOriginal.apply(this, args);
    });
    const executeOriginal = AgentToolExecutor.prototype.execute;
    const executeObserver = vi.spyOn(AgentToolExecutor.prototype, "execute").mockImplementation(async function (this: AgentToolExecutor, ...args) {
      const result = await executeOriginal.apply(this, args);
      console.log(JSON.stringify({ event: "repro-tool-result", tool: args[0].toolName,
        inputKeys: Object.keys(args[0].toolInput), ok: result.result.ok,
        output: result.result.ok ? summarizeReproOutput(result.result.output) : { error: result.result.error.code },
        evidenceCount: result.evidence.length, facts: result.evidence.map(item => Object.keys(item.facts)) }));
      return result;
    });
    const original = StrandsAgentEngine.prototype.run;
    let engineCalls = 0;
    const observer = vi.spyOn(StrandsAgentEngine.prototype, "run").mockImplementation(async function (this: StrandsAgentEngine, input) {
      engineCalls++;
      console.log(JSON.stringify({ event: "production-repro-input", source: process.env.GITHUB_SHA,
        model: environment.MODEL_ID, limits: input.limits,
        tools: input.tools.descriptors().map(({ name }) => name),
        initialIntentRevision: input.effectiveIntent?.intentRevision ?? null }));

      if (input.conditionController) {
        const applyOriginal = input.conditionController.apply;
        input = { ...input, conditionController: { ...input.conditionController, apply: async change => {
          try {
            const accepted = await applyOriginal(change);
            console.log(JSON.stringify({ event: "repro-condition", target: change.target, accepted: true }));
            return accepted;
          } catch (error) {
            console.log(JSON.stringify({ event: "repro-condition", target: change.target, accepted: false,
              errorName: error instanceof Error ? error.name : "unknown",
              code: safeReproCode((error as any)?.code), quoteMatches: input.userRequest.includes(change.quote) }));
            throw error;
          }
        } } };
      }
      const result = await original.call(this, input);
      console.log(JSON.stringify({ event: "production-repro-engine", stopReason: allowedStops.has(result.stopReason) ? result.stopReason : "other",
        limitReason: result.limitReason ?? null, metrics: result.metrics ?? null,
        evidenceCount: result.evidence.length, replyKind: result.replyProposal?.kind ?? null,
        toolOutcomes: result.trace.events.filter(event => event.type === "tool_completed")
          .map(event => event.type === "tool_completed" ? { tool: event.toolName, outcome: event.outcome } : null) }));
      return result;
    });
    try {
      const app = createProductionServerAgent("production-repro-synthetic-execution", environment);
      const input = { principal, conversationId, turnId: "73400000-0000-4000-8000-000000000001", userRequest: "出雲大社へ行ってみたい。魅力と近くの立ち寄り先を教えてください。" };
      let result: Awaited<ReturnType<typeof app.runConversationTurn>> | undefined;
      const started = Date.now();
      try { result = await app.runConversationTurn(input); }
      catch { console.log(JSON.stringify({ event: "production-repro-result", status: "failed", durationMs: Date.now() - started })); }
      const working = await new DynamoDbConversationTurnRepository("test-state", state.client).getWorkingState(principal, conversationId);
      console.log(JSON.stringify({ event: "production-repro-final", status: result?.status ?? "failed",
        cards: result?.publicPlacePresentation?.cards.length ?? 0,
        intentRevision: working?.semantic?.overlay.intentRevision ?? 0,
        engineCalls, durationMs: Date.now() - started }));
      expect.soft(result?.status, "First destination request must complete").toBe("completed");
      expect.soft(working?.semantic?.overlay.intentRevision, "Destination must be accepted").toBe(1);
      expect.soft(result?.publicPlacePresentation?.cards.length ?? 0, "Initial suggestion must be visible").toBeGreaterThan(0);
      if (result) {
        const before = engineCalls;
        expect((await app.runConversationTurn(input)).status).toBe(result.status);
        expect(engineCalls).toBe(before);
      }
    } finally { streamObserver.mockRestore(); executeObserver.mockRestore(); observer.mockRestore(); isolated.stateClient = undefined; isolated.tripClient = undefined; }
  }, 210000);
});

function safeReproCode(value: unknown) {
  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/.test(value) ? value : null;
}
function summarizeReproOutput(value: any): unknown {
  if (!value || typeof value !== "object") return { type: typeof value };
  return { keys: Object.keys(value), bytes: JSON.stringify(value).length, ok: value.ok,
    error: safeReproCode(value.error?.code), retryable: value.error?.retryable,
    outcome: value.outcome ? { status: safeReproCode(value.outcome.status),
      candidateCount: value.outcome.candidateCount, verifiedCandidateCount: value.outcome.verifiedCandidateCount,
      photoCandidateCount: value.outcome.photoCandidateCount,
      reasons: value.outcome.reasonCodes?.map(safeReproCode) } : undefined,
    hits: value.discovery?.batch?.hits?.length,
    pages: value.webPages?.data?.pages?.length, places: value.result?.data?.places?.length,
    evidenceCount: value.evidenceIds?.length, candidates: value.candidateReferences?.length,
    replyReferences: value.replyReferences?.map((ref: any) => Object.keys(ref.fields ?? {})),
    output: value.output ? summarizeReproOutput(value.output) : undefined };
}
