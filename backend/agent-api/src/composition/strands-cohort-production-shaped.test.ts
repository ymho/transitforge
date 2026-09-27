import { expect, it, vi } from "vitest";
import { Model, type BaseModelConfig, type Message, type ModelStreamEvent } from "@strands-agents/sdk";
import { createTrip } from "@raiquora/trip/trip";
import { stateDynamoFixture, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { StrandsAgentEngine } from "../adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "../adapters/strands-server-runtime.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";

class CohortModel extends Model<BaseModelConfig> {
  private index = 0;
  private config: BaseModelConfig = { modelId: "synthetic-cohort" };
  readonly messages: Message[][] = [];
  constructor(private readonly beforeTool?: () => void) { super(); }
  updateConfig(config: BaseModelConfig): void { this.config = { ...this.config, ...config }; }
  getConfig(): BaseModelConfig { return this.config; }
  async *stream(messages: Message[]): AsyncGenerator<ModelStreamEvent> {
    this.messages.push(structuredClone(messages));
    const first = this.index++ === 0;
    if (first) this.beforeTool?.();
    const name = first ? "update_current_party_details" : "strands_structured_output";
    const input = first ? { finalCohorts: [{ count: 1, membership: "additional", schoolStage: "university", ageDecade: "twenties",
      scope: { kind: "logical_days", fromDay: 2 } }], quote: "20代の大学生1人が2日目から追加参加" }
      : { reply: this.beforeTool ? { kind: "uncertainty" } : { kind: "conversation", message: "acknowledgement" } };
    yield { type: "modelMessageStartEvent", role: "assistant" };
    yield { type: "modelContentBlockStartEvent", start: { type: "toolUseStart", name, toolUseId: `cohort-${this.index}` } };
    yield { type: "modelContentBlockDeltaEvent", delta: { type: "toolUseInputDelta", input: JSON.stringify(input) } };
    yield { type: "modelContentBlockStopEvent" };
    yield { type: "modelMessageStopEvent", stopReason: "toolUse" };
  }
}

async function setup(stale = false, wrongOwner = false) {
  const principal = await cognitoTokenFixture().verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const trip = createTrip("72900000-0000-4000-8000-000000000001", "大学生との旅行", "2026-09-27T00:00:00Z", [],
    { party: { adults: 2, children: [], source: "user" }, constraints: [], assumptions: [] }, "inspiration", undefined,
    { version: 1, logicalDays: [{ id: "auth-day-a" }, { id: "auth-day-b" }, { id: "auth-day-c" }], calendarBindings: [] });
  trips.seed(trip, wrongOwner ? "somebody-else" : principal.subject);
  await state.conversations.create(principal, conversationId, { ...stateMetadata(), tripId: trip.id });
  const model = new CohortModel(stale ? () => trips.seed({ ...trip, revision: 1 }, principal.subject) : undefined);
  const legacy = { converse: vi.fn(async () => { throw new Error("V1 must not run"); }) };
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model: legacy, weather: { search: vi.fn(async () => { throw new Error("not used"); }) }, newExecutionId: () => "cohort-production-shaped",
    runRuntime: createStrandsServerRuntime(new StrandsAgentEngine({ modelId: "unused", region: "ap-northeast-1", systemPrompt: "Use the cohort Tool.", maxTurns: 3 }, { model })) });
  // No explicit tripId: it must be resolved from the owned Conversation association.
  const input = { principal, conversationId, turnId: secondId, userRequest: "20代の大学生1人が2日目から追加参加" };
  const turns = new DynamoDbConversationTurnRepository("test-state", state.client);
  return { state, trips, trip, model, legacy, app, input, turns };
}

it("resolves scope inside the owner-authenticated production path, persists one A commit and replays B without V1", async () => {
  const f = await setup(), profileBefore = await f.state.profiles.get(f.input.principal);
  const result = await f.app.runConversationTurn(f.input);
  expect(result.status).toBe("completed");
  const overlay = (await f.turns.getWorkingState(f.input.principal, conversationId))?.semantic?.overlay;
  expect(overlay?.intentRevision).toBe(1);
  expect(overlay?.facts).toHaveLength(1);
  expect(overlay?.facts[0]?.value).toEqual({ kind: "party_cohorts", cohorts: [{ count: 1, membership: "additional", schoolStage: "university", ageDecade: "twenties",
    scope: { kind: "logical_days", tripId: f.trip.id, tripRevision: 0, dayIds: ["auth-day-b", "auth-day-c"] } }] });
  expect(await f.trips.repository.get(f.input.principal, f.trip.id)).toEqual(f.trip);
  expect(await f.state.profiles.get(f.input.principal)).toEqual(profileBefore);
  expect(JSON.stringify(f.model.messages)).toContain("partyScopeChoices");
  const calls = f.model.messages.length;
  expect(await f.app.runConversationTurn(f.input)).toEqual(result);
  expect(f.model.messages).toHaveLength(calls);
  expect(f.legacy.converse).not.toHaveBeenCalled();
});
it("rejects a Trip structure changed after model input rather than remapping its ordinal selector", async () => {
  const f = await setup(true);
  const result = await f.app.runConversationTurn(f.input);
  expect(result.status).toBe("completed");
  expect((await f.turns.getWorkingState(f.input.principal, conversationId))?.semantic?.overlay.facts ?? []).toHaveLength(0);
  expect(JSON.stringify(f.model.messages)).toContain("stale_scope");
});
it("never presents another owner's Trip catalog to the model", async () => {
  const f = await setup(false, true);
  await expect(f.app.runConversationTurn(f.input)).rejects.toThrow();
  expect(f.model.messages).toHaveLength(0);
  expect(f.legacy.converse).not.toHaveBeenCalled();
});
