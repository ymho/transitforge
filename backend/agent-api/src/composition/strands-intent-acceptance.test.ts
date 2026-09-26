import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { AgentToolDescriptor } from "@raiquora/agent/tool-contract";
import type { ServerAgentRuntimeInput } from "../ports/server-agent-runtime.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";

type Step = { tool: string; input: Record<string, unknown> } | "end";
class IntentScenarioModel extends Model<BaseModelConfig> {
  readonly requests: string[] = [];
  private config: BaseModelConfig = { modelId: "synthetic-intent" };
  constructor(private readonly steps: Step[]) { super(); }
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(messages: Message[], _options?: StreamOptions): AsyncGenerator<ModelStreamEvent> {
    const step = this.steps[this.requests.length];
    this.requests.push(JSON.stringify(messages));
    if (!step) throw new Error("Unexpected model call");
    yield { type: "modelMessageStartEvent", role: "assistant" };
    if (step === "end") {
      yield { type: "modelContentBlockStartEvent" };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "textDelta", text: "not public" } };
    } else {
      yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: step.tool, toolUseId: `tool-${this.requests.length}` } };
      yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(step.input) } };
    }
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: step === "end" ? "endTurn" : "toolUse" };
  }
}
function update(label = "京都", overrides: Record<string, unknown> = {}): Step {
  return { tool: "update_intent", input: { outcome: "delta", speechAct: "inform", unresolvedFragments: [], operations: [{
    atomicGroup: 1, action: "set", target: "destination", modality: "preferred", precision: "exact",
    frame: "actual", quote: label, value: { kind: "place_label", label }, ...overrides,
  }] } };
}
const read = (place = "京都"): Step => ({ tool: "lookup_intent_place", input: { place } });
const uncertainty: Step = { tool: "submit_reply", input: { kind: "uncertainty" } };
const answer = (executionId: string): Step => ({ tool: "submit_reply", input: {
  kind: "answer", references: [{ evidenceId: `evidence:${executionId}:place`, field: "description" }],
} });
async function setup() {
  const principal = await cognitoTokenFixture().verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const { tripId: _tripId, ...metadata } = stateMetadata();
  await state.conversations.create(principal, conversationId, metadata);
  const turns = new DynamoDbConversationTurnRepository("test-state", state.client);
  const v1Model = { converse: vi.fn(async () => { throw new Error("V1 must not run"); }) };
  const operation = vi.fn(async () => ({ statusCode: 200, body: { verified: true } }));
  const descriptor: AgentToolDescriptor = {
    name: "lookup_intent_place", description: "受理済みの行き先について資料を確認する", effect: "read",
    inputSchema: { type: "object", properties: { place: { type: "string" } }, required: ["place"], additionalProperties: false },
    intentPolicy: { dependencies: ["destination"], requirements: [{ target: "destination", inputField: "place", necessity: "required", match: "exact" }] },
  };
  const evidence = (_output: unknown, context: { executionId: string; toolCallId: string; retrievedAt: string }): Evidence[] => [{
    id: `evidence:${context.executionId}:place`, category: "station", knowledgeKind: "deterministic_fact", subject: "確認済みの場所",
    facts: { description: "Toolが確認した資料です" },
    references: [{ sourceType: "session-state", sourceRef: "verified:place", retrievedAt: context.retrievedAt,
      freshness: "current", summary: "Toolが確認した資料です" }],
    observation: { observationId: `observation:${context.executionId}:${context.toolCallId}`, subjectKey: `place:${context.executionId}`,
      scopeKey: "conversation", predicate: "verified_place", retrievedAt: context.retrievedAt, applicability: "applicable", retention: "reference_only" },
  }];
  const build = (steps: Step[], executionId = "intent-acceptance") => {
    const model = new IntentScenarioModel(steps);
    const runtime = createStrandsServerRuntime(new StrandsAgentEngine({
      modelId: "unused", region: "ap-northeast-1", systemPrompt: "Use the Application Tools.", maxTurns: 8,
    }, { model }));
    const runRuntime = vi.fn((input: ServerAgentRuntimeInput) => runtime({ ...input,
      limits: { ...input.limits, maxIterations: 8, maxModelCalls: 8, maxToolCalls: 1 } }));
    const app = createConversationServerAgent({
      stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
      model: v1Model, weather: { search: vi.fn() }, additionalTools: [{ descriptor, operation, evidence }],
      // Even a stale V1 rollout option cannot add an interpreter call to the V2 path.
      semanticIntentEnabled: true, newExecutionId: () => executionId, runRuntime,
    });
    return { app, model, runRuntime };
  };
  return { principal, state, turns, v1Model, operation, build,
    input: { principal, conversationId, turnId: secondId, userRequest: "行き先は京都にしたい" } };
}

it("publishes updated-intent Evidence through A commit, a read, B commit, history and replay within one Domain Tool budget", async () => {
  const test = await setup();
  const { app, model } = test.build([update(), read(), answer("intent-acceptance"), "end"]);
  const reportReceipt = vi.fn(async () => {});
  const result = await app.runConversationTurn(test.input, undefined, reportReceipt);
  expect(result.status).toBe("completed");
  expect(result.response).toContain("Toolが確認した資料です");
  expect(result.semanticReceipt).toMatchObject({ intentRevision: 1 });
  expect(reportReceipt).toHaveBeenCalledOnce();
  expect(test.operation).toHaveBeenCalledOnce();
  expect(test.v1Model.converse).not.toHaveBeenCalled();
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision).toBe(1);
  const calls = model.requests.length;
  expect(await app.runConversationTurn(test.input)).toEqual(result);
  expect(model.requests).toHaveLength(calls);
  expect(test.operation).toHaveBeenCalledOnce();
  expect((await test.state.conversations.history(test.principal, conversationId)).items.map(({ text }) => text))
    .toEqual([test.input.userRequest, result.response]);
});

it("uses corrected conditions for both read validation and publication on a later turn", async () => {
  const test = await setup();
  const first = test.build([update("神戸"), read("神戸"), answer("intent-kobe"), "end"], "intent-kobe");
  await first.app.runConversationTurn({ ...test.input, userRequest: "行き先は神戸にしたい" });
  const next = test.build([read("京都"), update("京都", { action: "replace" }), read("京都"), answer("intent-kyoto"), "end"], "intent-kyoto");
  const result = await next.app.runConversationTurn({ ...test.input,
    turnId: "71200000-0000-4000-8000-000000000002", userRequest: "行き先を京都に変更したい" });
  expect(result.status).toBe("completed");
  expect(result.semanticReceipt).toMatchObject({ intentRevision: 2 });
  // The Kyoto lookup before acceptance was rejected without consuming the one-read budget.
  expect(test.operation).toHaveBeenCalledTimes(2);
  const working = await test.turns.getWorkingState(test.principal, conversationId);
  expect(working?.semantic?.overlay.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ target: "destination", value: { kind: "place_label", label: "京都" } }),
  ]));
  expect(test.v1Model.converse).not.toHaveBeenCalled();
});

it.each([
  ["quote", { quote: "大阪" }],
  ["date", { target: "start_date", value: { kind: "local_date", date: "2026-10-01" } }],
  ["scope", { scope: { kind: "logical_day_ordinal", ordinal: 2 } }],
] as const)("rejects an ungrounded %s delta without committing intent", async (_kind, overrides) => {
  const test = await setup();
  const { app, model } = test.build([update("京都", overrides), uncertainty, "end"]);
  const result = await app.runConversationTurn(test.input);
  expect(result.semanticReceipt).toBeUndefined();
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision ?? 0).toBe(0);
  expect(model.requests.join("\n")).toContain("intent_rejected");
  expect(test.operation).not.toHaveBeenCalled();
  expect(test.v1Model.converse).not.toHaveBeenCalled();
});

it("does not mutate intent after reply submission or on an unchanged conversational turn", async () => {
  const scenarios: { userRequest: string; steps: Step[] }[] = [
    { userRequest: "行き先は京都にしたい", steps: [uncertainty, update(), "end"] },
    { userRequest: "こんにちは", steps: [{ tool: "submit_reply", input: { kind: "conversation", message: "greeting" } }, "end"] },
  ];
  for (const { userRequest, steps } of scenarios) {
    const test = await setup();
    const { app } = test.build(steps);
    const result = await app.runConversationTurn({ ...test.input, userRequest });
    expect(result.semanticReceipt).toBeUndefined();
    expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision ?? 0).toBe(0);
    expect(test.operation).not.toHaveBeenCalled();
    expect(test.v1Model.converse).not.toHaveBeenCalled();
  }
});

it("does not retry an intent mutation in the same invocation after validation rejection", async () => {
  const test = await setup();
  const { app, model } = test.build([update("京都", { quote: "大阪" }), update(), uncertainty, "end"]);
  const result = await app.runConversationTurn(test.input);
  expect(result.semanticReceipt).toBeUndefined();
  expect(model.requests.join("\n")).toContain("intent_update_limit");
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision ?? 0).toBe(0);
});

it("fails closed after post-commit context refresh failure and resumes without a second intent application", async () => {
  const test = await setup();
  const first = test.build([update(), read(), uncertainty, "end"], "intent-refresh-failure");
  const reportReceipt = vi.fn(async () => {
    vi.spyOn(test.state.client, "send").mockRejectedValueOnce(new Error("synthetic context refresh failure"));
  });
  await expect(first.app.runConversationTurn(test.input, undefined, reportReceipt)).rejects.toBeDefined();
  expect(test.operation).not.toHaveBeenCalled();
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision).toBe(1);
  expect((await test.state.conversations.history(test.principal, conversationId)).items).toHaveLength(1);
  const retry = test.build([read(), answer("intent-retry"), "end"], "intent-retry");
  const result = await retry.app.runConversationTurn(test.input);
  expect(result.status).toBe("completed");
  expect(result.semanticReceipt).toMatchObject({ intentRevision: 1 });
  expect(retry.runRuntime.mock.calls[0]?.[0].intentController).toBeUndefined();
  expect(test.operation).toHaveBeenCalledOnce();
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision).toBe(1);
  expect(await retry.app.runConversationTurn(test.input)).toEqual(result);
  expect(test.operation).toHaveBeenCalledOnce();
  expect((await test.state.conversations.history(test.principal, conversationId)).items).toHaveLength(2);
  expect(test.v1Model.converse).not.toHaveBeenCalled();
});
