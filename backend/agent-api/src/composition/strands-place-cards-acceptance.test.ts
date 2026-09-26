import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { productionServerTools } from "./production-server-tools.js";
import { createProductionAgentStream } from "../agent-stream-composition.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import type { StreamWriter } from "../ports/agent-stream-transport.js";
import { agentV2SystemPrompt } from "../usecases/agent-v2-system-prompt.js";

type Step = { tool: string; input: Record<string, unknown> } | "candidates" | "end";
const read: Step = { tool: "search_place_media", input: { query: "青葉庭園", mode: "discovery", limit: 1 } };
const uncertainty: Step = { tool: "strands_structured_output", input: { kind: "uncertainty" } };
const update: Step = { tool: "update_intent", input: { outcome: "delta", speechAct: "inform", unresolvedFragments: [], operations: [{
  atomicGroup: 1, action: "set", target: "destination", modality: "preferred", precision: "exact",
  frame: "actual", quote: "青葉庭園", value: { kind: "place_label", label: "青葉庭園" },
}] } };

/** The fixture selects returned references, not mapper-specific IDs or V1 loop behavior. */
class CandidateModel extends Model<BaseModelConfig> {
  calls = 0;
  seenCandidateIds: string[] = [];
  private config: BaseModelConfig = { modelId: "synthetic-candidates" };
  constructor(private readonly steps: Step[]) { super(); }
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(messages: Message[], _options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    const step = this.steps[this.calls++];
    if (!step) throw new Error("Unexpected model invocation");
    const ids = candidateIds(JSON.parse(JSON.stringify(messages)));
    this.seenCandidateIds = [...new Set([...this.seenCandidateIds, ...ids])];
    const proposal = step === "candidates" ? { tool: "strands_structured_output", input: { kind: "candidates",
      evidenceIds: ids.slice(-1), commentary: "散策先として、この庭園を検討できます。" } } : step;
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (proposal === "end") {
      yield { type: "modelContentBlockStartEvent" };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "DO_NOT_PUBLISH_MODEL_TRAILER" } };
    } else {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: proposal.tool, toolUseId: `tool-${this.calls}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(proposal.tool === "strands_structured_output" ? { reply: proposal.input } : proposal.input) } };
    }
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: proposal === "end" ? "endTurn" : "toolUse" };
  }
}
function candidateIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(candidateIds);
  if (typeof value === "string") { try { return candidateIds(JSON.parse(value)); } catch { return []; } }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.candidateReferences)) return record.candidateReferences.flatMap((ref) =>
    ref && typeof ref === "object" && typeof ref.evidenceId === "string" ? [ref.evidenceId] : []);
  return Object.values(record).flatMap(candidateIds);
}
async function setup(empty = false) {
  const { verifier } = cognitoTokenFixture();
  const principal = await verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const { tripId: _tripId, ...metadata } = stateMetadata();
  await state.conversations.create(principal, conversationId, metadata);
  const turns = new DynamoDbConversationTurnRepository("test-state", state.client);
  const sourceUrl = "https://example.org/places/garden";
  const searchPlaceMedia = vi.fn(async () => ({ result: empty
    ? { status: "unavailable", freshness: "unknown", evidence: [] }
    : { status: "available", freshness: "fresh", data: { places: [{ providerPlaceId: "garden", name: "青葉庭園",
      summary: "池の周囲を歩いて見学する庭園です。", sourceUrl, openingHoursStatus: "unknown" }] },
      evidence: [{ id: "place-source", provider: "fixture", sourceUrl, retrievedAt: "2026-09-26T10:00:00Z" }] } }));
  const v1 = { converse: vi.fn(async () => { throw new Error("V1 must not run"); }) };
  const accommodation = vi.fn(), journey = vi.fn();
  const build = (steps: Step[], executionId = "v2-place-cards") => {
    const model = new CandidateModel(steps);
    const app = createConversationServerAgent({
      stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
      model: v1, weather: { search: vi.fn() }, newExecutionId: () => executionId,
      runRuntime: createStrandsServerRuntime(new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1",
        systemPrompt: agentV2SystemPrompt, maxTurns: 8 }, { model })),
      limits: { maxIterations: 8, maxModelCalls: 8, maxToolCalls: 2 },
      additionalTools: productionServerTools({ external: { searchPlaceMedia }, accommodation, journey }),
    });
    return { app, model };
  };
  return { verifier, principal, state, trips, turns, searchPlaceMedia, accommodation, journey, v1, build,
    input: { principal, conversationId, turnId: secondId, userRequest: "青葉庭園に行きたい" } };
}

it("publishes a real travel read as cards through Strands, A/B commits, owner-scoped history and replay without photos or writes", async () => {
  const test = await setup();
  const { app, model } = test.build([update, read, "candidates", "end"]);
  const result = await app.runConversationTurn(test.input);
  expect(result.status).toBe("completed");
  expect(result.semanticReceipt).toMatchObject({ intentRevision: 1 });
  expect(result.response).toBe("散策先として、この庭園を検討できます。");
  expect(result.publicPlacePresentation?.cards).toEqual([{ evidenceId: expect.any(String), placeRef: "place:fixture:garden",
    title: "青葉庭園", description: "池の周囲を歩いて見学する庭園です。", sourceUrl: "https://example.org/places/garden" }]);
  expect(result.publicPlacePresentation?.cards[0]?.evidenceId).toBe(model.seenCandidateIds[0]);
  expect(result).not.toHaveProperty("publicPlanPresentation");
  expect(JSON.stringify(result)).not.toContain("DO_NOT_PUBLISH_MODEL_TRAILER");
  expect(test.searchPlaceMedia).toHaveBeenCalledOnce();
  expect(test.accommodation).not.toHaveBeenCalled(); expect(test.journey).not.toHaveBeenCalled(); expect(test.v1.converse).not.toHaveBeenCalled();
  const history = await test.state.conversations.history(test.principal, conversationId);
  expect(history.items.map(({ role }) => role)).toEqual(["user", "assistant"]);
  expect(history.items[1]?.publicPlacePresentation).toEqual(result.publicPlacePresentation);
  const calls = model.calls;
  expect(await app.runConversationTurn(test.input)).toEqual(result);
  expect(model.calls).toBe(calls); expect(test.searchPlaceMedia).toHaveBeenCalledOnce();
  const working = await test.turns.getWorkingState(test.principal, conversationId);
  expect(working?.groundingEvidence?.map(({ id }) => id)).toContain(result.publicPlacePresentation!.cards[0]!.evidenceId);
  const foreign = await test.verifier.verify(token({ sub: "another-user" }));
  await expect(test.state.conversations.history(foreign, conversationId)).rejects.toBeDefined();
  await expect(app.runConversationTurn({ ...test.input, principal: foreign })).rejects.toBeDefined();
  expect(model.calls).toBe(calls); expect(test.searchPlaceMedia).toHaveBeenCalledOnce();
});

it("cannot publish old candidate Evidence after an intent update and can retry against the committed conditions", async () => {
  const test = await setup();
  const first = test.build([read, update, "candidates", "end"]);
  await expect(first.app.runConversationTurn(test.input)).rejects.toMatchObject({ code: "agent_failed" });
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision).toBe(1);
  expect((await test.state.conversations.history(test.principal, conversationId)).items).toHaveLength(1);
  const retry = test.build([read, "candidates", "end"], "v2-cards-retry");
  const result = await retry.app.runConversationTurn(test.input);
  expect(result.publicPlacePresentation?.cards).toHaveLength(1);
  expect(result.semanticReceipt).toMatchObject({ intentRevision: 1 });
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision).toBe(1);
  expect(await retry.app.runConversationTurn(test.input)).toEqual(result);
  expect(test.searchPlaceMedia).toHaveBeenCalledTimes(2);
  expect(test.v1.converse).not.toHaveBeenCalled();
});

it("returns uncertainty without fabricated cards when the travel Provider has no usable places", async () => {
  const test = await setup(true);
  const { app, model } = test.build([read, uncertainty, "end"]);
  const result = await app.runConversationTurn(test.input);
  expect(result.status).toBe("completed");
  expect(result.publicPlacePresentation).toBeUndefined();
  expect(model.seenCandidateIds).toEqual([]);
  expect(await app.runConversationTurn(test.input)).toEqual(result);
  expect(test.searchPlaceMedia).toHaveBeenCalledOnce();
});

it("rejects a model-selected foreign Evidence reference without saving a successful candidate reply", async () => {
  const test = await setup();
  const { app } = test.build([read, { tool: "strands_structured_output", input: {
    kind: "candidates", evidenceIds: ["foreign-evidence"], commentary: "確認できました。",
  } }, "end"]);
  await expect(app.runConversationTurn(test.input)).rejects.toMatchObject({ code: "agent_failed" });
  expect((await test.state.conversations.history(test.principal, conversationId)).items).toHaveLength(1);
});

it("commits cards before final SSE bytes and replays them after a lost response without repeating a travel read", async () => {
  const test = await setup();
  const { app, model } = test.build([read, "candidates", "end"]);
  const handle = createProductionAgentStream({ enabled: true, path: "/api/agent-stream", verifier: test.verifier,
    createApplication: () => app, newExecutionId: () => "cards-stream", log: vi.fn() });
  const request = { method: "POST", path: "/api/agent-stream", apiRequestId: "gateway", lambdaRequestId: "lambda",
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: JSON.stringify({ conversationId, turnId: secondId, userRequest: test.input.userRequest }) };
  let disconnect = true;
  const frames: string[] = [];
  const writer: StreamWriter = { signal: new AbortController().signal, start: vi.fn(), end: vi.fn(async () => {}),
    write: async (frame) => {
      if (frame.includes('"type":"final"')) {
        expect((await test.state.conversations.history(test.principal, conversationId)).items[1]?.publicPlacePresentation?.cards).toHaveLength(1);
        if (disconnect) throw new Error("lost final response");
      }
      frames.push(frame);
    } };
  await handle(request, writer);
  const calls = model.calls;
  disconnect = false; frames.length = 0;
  await handle(request, writer);
  const payload = frames.join("");
  expect(payload).toContain('"publicPlacePresentation"');
  expect(payload).toContain('"title":"青葉庭園"');
  expect(frames.at(-1)).toContain("event: done");
  expect(payload).not.toMatch(/intentDependency|groundingEvidence|DO_NOT_PUBLISH|toolUse|identity-v1/u);
  expect(model.calls).toBe(calls); expect(test.searchPlaceMedia).toHaveBeenCalledOnce();
  expect((await test.state.conversations.history(test.principal, conversationId)).items).toHaveLength(2);
});
