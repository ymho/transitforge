import { applyTripProposal, createTrip } from "@raiquora/trip/trip";
import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent, type StreamOptions } from "@strands-agents/sdk";
import type { Evidence } from "@raiquora/agent/evidence-model";
import type { AgentToolDescriptor } from "@raiquora/agent/tool-contract";
import type { ServerAgentRuntimeInput } from "../ports/server-agent-runtime.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata, stateProfile } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { DynamoDbTripRepository } from "../adapters/dynamodb-trip-repository.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { createProductionAgentStream } from "../agent-stream-composition.js";
import type { StreamWriter } from "../ports/agent-stream-transport.js";

type ToolStep = { tool: string; input: Record<string, unknown> };
type Step = ToolStep | ToolStep[] | "end";
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
      yield { type: "modelContentBlockStopEvent" };
    } else {
      for (const [index, call] of (Array.isArray(step) ? step : [step]).entries()) {
        yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name: call.tool, toolUseId: `tool-${this.requests.length}-${index}` } };
        yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(call.tool === "strands_structured_output" ? { reply: call.input } : call.input) } };
        yield { type: "modelContentBlockStopEvent" };
      }
    }
    yield { type: "modelMessageStopEvent", stopReason: step === "end" ? "endTurn" : "toolUse" };
  }
}
function update(label = "京都", overrides: Record<string, unknown> = {}): ToolStep {
  return { tool: "update_current_destination", input: { action: "set", place: label, quote: label, ...overrides } };
}
const origin = (place = "大阪"): ToolStep => ({ tool: "update_current_origin", input: { action: "set", place, quote: place } });

const read = (place = "京都"): Step => ({ tool: "lookup_intent_place", input: { place } });
const uncertainty: Step = { tool: "strands_structured_output", input: { kind: "uncertainty" } };
const answer = (executionId: string): Step => ({ tool: "strands_structured_output", input: {
  kind: "answer", references: [{ evidenceId: `evidence:${executionId}:place`, field: "description" }],
} });
async function setup() {
  const { verifier } = cognitoTokenFixture();
  const principal = await verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const metadata = stateMetadata();
  trips.seed(createTrip(stateMetadata().tripId, "検討中の旅", "2026-09-14T00:00:00Z"), principal.subject);
  await state.conversations.create(principal, conversationId, metadata);
  const turns = new DynamoDbConversationTurnRepository("test-state", state.client);

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
       weather: { search: vi.fn() }, additionalTools: [{ descriptor, operation, evidence }],
             newExecutionId: () => executionId, runRuntime,
    });
    return { app, model, runRuntime };
  };
  return { verifier, principal, state, trips, turns, operation, build,
    input: { principal, conversationId, turnId: secondId, userRequest: "行き先は京都にしたい" } };
}

it("persists accepted conditions through the authenticated stream, reloads them from Trip, and replays a correction", async () => {
  const test = await setup();
  const stream = async (app: ReturnType<typeof test.build>["app"], input: typeof test.input, executionId: string) => {
    const frames: string[] = [];
    const handle = createProductionAgentStream({ enabled: true, path: "/api/agent-stream", verifier: test.verifier,
      createApplication: () => app, newExecutionId: () => executionId, log: vi.fn() });
    const writer: StreamWriter = { signal: new AbortController().signal, start: vi.fn(), end: vi.fn(async () => {}),
      write: async (frame) => { frames.push(frame); } };
    await handle({ method: "POST", path: "/api/agent-stream", apiRequestId: "gateway", lambdaRequestId: "lambda",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      body: JSON.stringify({ conversationId: input.conversationId, turnId: input.turnId, userRequest: input.userRequest }) }, writer);
    expect(writer.start).toHaveBeenCalledWith(200, expect.anything());
    expect(frames.at(-1)).toContain("event: done");
    return frames.join("");
  };

  const first = test.build([update("京都"), uncertainty], "stream-condition-first");
  const firstPayload = await stream(first.app, test.input, "stream-condition-first");
  expect(firstPayload).toContain('"type":"intent_accepted"');
  expect(firstPayload).toContain("今回の相談条件（反映済み）");
  const firstReload = await test.trips.repository.get(test.principal, stateMetadata().tripId);
  expect(firstReload?.request.constraints.some(({ requirement }) => requirement.type === "destinations" &&
    requirement.places.some(({ name }) => name === "京都"))).toBe(true);

  const correctedInput = { ...test.input, turnId: "71111111-1111-4111-8111-111111111112", userRequest: "行き先を大阪に訂正したい" };
  const corrected = test.build([update("大阪"), uncertainty], "stream-condition-corrected");
  const correctedPayload = await stream(corrected.app, correctedInput, "stream-condition-corrected");
  expect(correctedPayload).toContain("行き先：大阪");
  const correctedReload = await test.trips.repository.get(test.principal, stateMetadata().tripId);
  const destinations = correctedReload?.request.constraints.flatMap(({ requirement }) =>
    requirement.type === "destinations" ? requirement.places.map(({ name }) => name) : []) ?? [];
  expect(destinations).toEqual(["大阪"]);
  const calls = corrected.model.requests.length;
  expect(await stream(corrected.app, correctedInput, "stream-condition-replay")).toContain("行き先：大阪");
  expect(corrected.model.requests).toHaveLength(calls);
  expect((await test.state.conversations.history(test.principal, conversationId)).items).toHaveLength(4);
});

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
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision).toBe(1);
  const calls = model.requests.length;
  expect(await app.runConversationTurn(test.input)).toEqual(result);
  expect(model.requests).toHaveLength(calls);
  expect(test.operation).toHaveBeenCalledOnce();
  expect((await test.state.conversations.history(test.principal, conversationId)).items.map(({ text }) => text))
    .toEqual([test.input.userRequest, result.response]);
});

it("persists an accepted destination into Trip.request before treating it as reflected", async () => {
  const test = await setup();
  const { app } = test.build([update("出雲大社"), uncertainty], "trip-authority-destination");
  const result = await app.runConversationTurn({ ...test.input, userRequest: "出雲大社に行きたい" });
  const saved = await test.trips.repository.get(test.principal, stateMetadata().tripId);
  expect(saved?.request.constraints).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: "user", requirement: expect.objectContaining({
      type: "destinations", places: [expect.objectContaining({ name: "出雲大社" })],
    }) }),
  ]));
  expect(result.tripUpdateProposal).toBeUndefined();
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.facts
    .some(({ target }) => target === "destination")).toBe(false);
});

it("does not publish accepted state when the Trip mutation fails before commit", async () => {
  const test = await setup();
  const { app } = test.build([update("出雲大社"), uncertainty], "trip-authority-failure");
  test.trips.faults.beforeTransaction = () => { throw new Error("synthetic Trip write failure"); };
  const reportReceipt = vi.fn(async () => {});
  await expect(app.runConversationTurn({ ...test.input, userRequest: "出雲大社に行きたい" }, undefined, reportReceipt)).rejects.toBeDefined();
  expect(reportReceipt).not.toHaveBeenCalled();
  const saved = await test.trips.repository.get(test.principal, stateMetadata().tripId);
  expect(saved?.revision).toBe(0);
  expect(saved?.request.constraints).toEqual([]);
  expect((await test.state.conversations.history(test.principal, conversationId)).items).toHaveLength(1);
});

it("uses corrected conditions for both read validation and publication on a later turn", async () => {
  const test = await setup();
  const first = test.build([update("神戸"), read("神戸"), answer("intent-kobe"), "end"], "intent-kobe");
  await first.app.runConversationTurn({ ...test.input, userRequest: "行き先は神戸にしたい" });
  const next = test.build([update("京都"), read("京都"), answer("intent-kyoto"), "end"], "intent-kyoto");
  const result = await next.app.runConversationTurn({ ...test.input,
    turnId: "71200000-0000-4000-8000-000000000002", userRequest: "行き先を京都に変更したい" });
  expect(result.status).toBe("completed");
  expect(result.semanticReceipt).toMatchObject({ intentRevision: 2 });
  // The Kyoto lookup before acceptance was rejected without consuming the one-read budget.
  expect(test.operation).toHaveBeenCalledTimes(2);
  const working = await test.turns.getWorkingState(test.principal, conversationId);
  expect(working?.semantic?.overlay.facts.some(({ target }) => target === "destination")).toBe(false);
  const saved = await test.trips.repository.get(test.principal, stateMetadata().tripId);
  expect(saved?.request.constraints.some(({ requirement }) => requirement.type === "destinations" && requirement.places.some(({ name }) => name === "京都"))).toBe(true);
});

it.each([
  ["quote", { quote: "大阪" }],
  ["authority", { owner: "someone-else" }],
  ["scope", { scope: { kind: "logical_day_ordinal", ordinal: 2 } }],
  ["null setter", { place: null }],
] as const)("rejects invalid %s input without changing conditions", async (_kind, overrides) => {
  const test = await setup();
  const { app } = test.build([update("京都", overrides), uncertainty]);
  const result = await app.runConversationTurn(test.input);
  expect(result.semanticReceipt).toBeUndefined();
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision ?? 0).toBe(0);
  expect(test.operation).not.toHaveBeenCalled();
});

it("does not mutate intent after reply submission or on an unchanged conversational turn", async () => {
  const scenarios: { userRequest: string; steps: Step[] }[] = [
    { userRequest: "行き先は京都にしたい", steps: [uncertainty, update(), "end"] },
    { userRequest: "こんにちは", steps: [{ tool: "strands_structured_output", input: { kind: "conversation", message: "greeting" } }, "end"] },
  ];
  for (const { userRequest, steps } of scenarios) {
    const test = await setup();
    const { app } = test.build(steps);
    const result = await app.runConversationTurn({ ...test.input, userRequest });
    expect(result.semanticReceipt).toBeUndefined();
    expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.intentRevision ?? 0).toBe(0);
    expect(test.operation).not.toHaveBeenCalled();
  }
});

it("executes independent conditions in one model response before reading and replaying the final reply", async () => {
  const test = await setup();
  const { app, model } = test.build([[origin(), update()], read(), answer("intent-acceptance")]);
  const input = { ...test.input, userRequest: "大阪から京都に行きたい" };
  const result = await app.runConversationTurn(input);
  expect(result.semanticReceipt?.changes.map(({ target }) => target).sort()).toEqual(["destination", "origin"]);
  const state = await test.turns.getWorkingState(test.principal, conversationId);
  expect(state?.semantic?.overlay.facts.filter(({ target }) => ["origin","destination"].includes(target))).toEqual([]);
  const saved = await test.trips.repository.get(test.principal, stateMetadata().tripId);
  expect(saved?.request.constraints.some(({ requirement }) => requirement.type === "origin" && requirement.place.name === "大阪")).toBe(true);
  expect(saved?.request.constraints.some(({ requirement }) => requirement.type === "destinations" && requirement.places.some(({ name }) => name === "京都"))).toBe(true);
  expect(test.operation).toHaveBeenCalledOnce();
  expect(model.requests).toHaveLength(3); // A specific two-call batch does not need a separate model round-trip per write.
  expect(await app.runConversationTurn(input)).toEqual(result);
  expect(model.requests).toHaveLength(3);
  expect(result.consultationRequestProposal).toBeUndefined();
  expect(result.tripUpdateProposal).toBeUndefined();
});

it("does not revive an old conversation condition after the Trip was manually edited", async () => {
  const test = await setup();
  const first = test.build([update("京都"), uncertainty], "manual-edit-first");
  await first.app.runConversationTurn({ ...test.input, userRequest: "京都に行きたい" });
  const current = (await test.trips.repository.get(test.principal, stateMetadata().tripId))!;
  const request = { ...current.request, constraints: current.request.constraints.map((constraint) => {
    if (constraint.requirement.type !== "destinations") return constraint;
    const { semantic: _semantic, ...manual } = constraint;
    return { ...manual, requirement: { ...constraint.requirement, places: [{ name: "神戸", sources: [] }] } };
  }) };
  const proposal = { tripId: current.id, baseRevision: current.revision, summary: "手動で行き先を神戸へ変更",
    patches: [{ type: "request" as const, request }] };
  const manualTrips = new DynamoDbTripRepository("test-trips", test.trips.client,
    { now: () => new Date(Date.parse(current.updatedAt) + 1_000) });
  await manualTrips.applyMutation(test.principal, { tripId: current.id, baseRevision: current.revision,
    mutationId: "99999999-9999-4999-8999-999999999999", proposal }, (trip) => applyTripProposal(trip, proposal));
  const probe = test.build([uncertainty], "manual-edit-probe");
  await probe.app.runConversationTurn({ ...test.input, turnId: "79999999-9999-4999-8999-999999999999", userRequest: "今の行き先で相談を続けたい" });
  const effective = probe.runRuntime.mock.calls[0]?.[0].context?.effectiveIntent;
  expect(effective?.actualConversationFacts.some(({ target }) => target === "destination")).toBe(false);
  expect(effective?.activeBaseFacts.some(({ target, requirement }) => target === "destination" &&
    requirement.type === "destinations" && requirement.places.some(({ name }) => name === "神戸"))).toBe(true);
  expect(effective?.activeBaseFacts.some(({ requirement }) => requirement.type === "destinations" &&
    requirement.places.some(({ name }) => name === "京都"))).toBe(false);
});

it("uses standard Tool validation feedback and accepts a valid operation after rejected input", async () => {
  const test = await setup();
  const { app } = test.build([update("京都", { place: null }), update(), read(), answer("intent-acceptance")]);
  const result = await app.runConversationTurn(test.input);
  expect(result.semanticReceipt?.intentRevision).toBe(1);
  expect(test.operation).toHaveBeenCalledOnce();
});

it("recovers a lost Trip mutation response without duplicating the accepted condition", async () => {
  const test = await setup();
  test.trips.faults.lostResponse = true;
  const first = test.build([update(), read(), answer("intent-trip-lost-response")], "intent-trip-lost-response");
  const result = await first.app.runConversationTurn(test.input);
  expect(result.status).toBe("completed");
  expect(result.semanticReceipt).toMatchObject({ intentRevision: 1 });
  const saved = await test.trips.repository.get(test.principal, stateMetadata().tripId);
  expect(saved?.revision).toBe(1);
  expect(saved?.request.constraints.some(({ requirement }) => requirement.type === "destinations" &&
    requirement.places.some(({ name }) => name === "京都"))).toBe(true);
  expect((await test.turns.getWorkingState(test.principal, conversationId))?.semantic?.overlay.facts).toEqual([]);
  expect(await first.app.runConversationTurn(test.input)).toEqual(result);
  expect((await test.trips.repository.get(test.principal, stateMetadata().tripId))?.revision).toBe(1);
});



it("overrides profile hints only in this Conversation and retracts without reviving a hidden default", async () => {
  const test = await setup();
  const savedProfile = await test.state.profiles.put(test.principal, { ...stateProfile(), usualOrigin: "神戸" }, null);
  const first = test.build([origin(), update(), read(), answer("profile-first")], "profile-first");
  const input = { ...test.input, userRequest: "今回は大阪から京都に行きたい" };
  const result = await first.app.runConversationTurn(input);
  expect(result.status).toBe("completed");
  expect(await test.state.profiles.get(test.principal)).toEqual(savedProfile);
  const final = test.build([{ tool: "update_current_origin", input: { action: "clear", quote: "出発地を未定に戻して" } }, uncertainty], "profile-clear");
  await final.app.runConversationTurn({ ...input, turnId: "71600000-0000-4000-8000-000000000005", userRequest: "出発地を未定に戻して" });
  expect(await test.state.profiles.get(test.principal)).toEqual(savedProfile);
  const probe = test.build([uncertainty], "profile-probe");
  await probe.app.runConversationTurn({ ...input, turnId: "71600000-0000-4000-8000-000000000006", userRequest: "今の条件で相談を続けたい" });
  const effective = probe.runRuntime.mock.calls[0]?.[0].context?.effectiveIntent;
  expect(effective?.actualConversationFacts.some(({ target }) => target === "origin")).toBe(false);
  expect(effective?.profileHints.some(({ target }) => target === "origin")).toBe(false);
  expect(effective?.activeBaseFacts.some(({ target, requirement }) => target === "destination" && requirement.type === "destinations")).toBe(true);
});
