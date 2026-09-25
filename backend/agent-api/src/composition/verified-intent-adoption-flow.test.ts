import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import type { ConversationModel, ConversationModelRequest } from "../ports/conversation-model.js";
import { stateDynamoFixture, stateA, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import { TripApplication } from "../usecases/trip-application.js";

it("adopts only bound verified changes, consumes them once, and retains unrelated intent", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await trips.repository.create(stateA, createTrip(secondId, "旅", "2026-09-14T00:00:00Z"));
  await state.conversations.create(stateA, conversationId, { ...stateMetadata(), tripId: secondId });
  const model: ConversationModel = { converse: vi.fn(async (request: ConversationModelRequest) => {
    if (request.outputContract?.name === "conversation_semantic_delta") return { message: { role: "assistant" as const, content: [{ text: JSON.stringify({
      outcome: "delta", speechAct: "inform", operations: [
        { atomicGroup: 1, action: "set", target: "destination", modality: "required", precision: "exact", frame: "actual", quote: "京都", value: { kind: "place_label", label: "京都" } },
        { atomicGroup: 2, action: "set", target: "party_size", modality: "required", precision: "exact", frame: "actual", quote: "2人", value: { kind: "quantity", amount: 2, unit: "people" } },
      ], unresolvedFragments: [],
    }) }] }, stopReason: "end_turn" as const, metadata: { modelId: "semantic", latencyMs: 1 } };
    return { message: { role: "assistant" as const, content: [{ text: JSON.stringify({ kind: "ask", responseText: "外部の最新情報を調べてもよいですか？",
      missingRequirements: [{ action: "ask", field: "research_authorization", resolution: "authorization", reason: "外部調査の許可を確認する" }] }) }] },
      stopReason: "end_turn" as const, metadata: { modelId: "answer", latencyMs: 1, outputMode: "application_strict" as const } };
  }) };
  const agent = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model, weather: { search: vi.fn() }, semanticIntentEnabled: true, newExecutionId: () => "execution" });
  const result = await agent.runConversationTurn({ principal: stateA, conversationId, turnId: "33333333-3333-4333-8333-333333333333",
    userRequest: "京都へ2人で行きたい" });
  const proposal = result.tripUpdateProposal!;
  expect(proposal.intentBinding?.changes.map(({ target }) => target)).toEqual(["destination"]);

  const turns = new DynamoDbConversationTurnRepository("test-state", state.client);
  const application = new TripApplication(trips.repository, trips.repository, trips.clock, undefined, undefined, undefined, turns);
  const mutationId = "44444444-4444-4444-8444-444444444444";
  const command = { version: "trip-api-v1" as const, operation: "mutate" as const, tripId: secondId, baseRevision: 0, mutationId, proposal };
  trips.faults.beforeTransaction = () => { state.faults.beforeWrite = () => { throw new Error("state completion unavailable"); }; };
  await expect(application.execute(stateA, command)).rejects.toMatchObject({ code: "unavailable" });
  expect((await trips.repository.get(stateA, secondId))?.revision).toBe(1);
  expect((await turns.getWorkingState(stateA, conversationId))?.semantic?.adoptionInFlight?.mutationId).toBe(mutationId);
  const blockedIdentity = { principal: stateA, conversationId, turnId: "66666666-6666-4666-8666-666666666666" };
  await expect(turns.beginTurn(blockedIdentity, { userRequest: "大阪へ訂正", tripId: secondId })).rejects.toMatchObject({ code: "conflict" });
  const committed = await application.execute(stateA, command);
  expect(committed).toMatchObject({ revision: 1, mutationId });
  expect((await trips.repository.get(stateA, secondId))?.request.constraints[0]).toMatchObject({ source: "user",
    requirement: { type: "destinations", places: [{ name: "京都" }] }, semantic: { facts: [{ target: "destination" }] } });
  const working = await turns.getWorkingState(stateA, conversationId);
  expect(working?.semantic?.overlay.facts.map(({ target }) => target)).toEqual(["party_size"]);
  expect(working?.semantic?.adoptions).toMatchObject([{ mutationId, committedTripRevision: 1,
    binding: { changes: [{ target: "destination" }] } }]);
  expect(working?.semantic?.pendingProposal).toBeUndefined();
  expect(working?.semantic?.adoptionInFlight).toBeUndefined();
  expect(working?.target.tripRevision).toBe(1);
  expect(await application.execute(stateA, command)).toMatchObject({ revision: 1, mutationId });
});

it("rejects an old intent binding before Trip mutation after meaning changes", async () => {
  const f = await verifiedProposalFixture();
  const identity = { principal: stateA, conversationId, turnId: "77777777-7777-4777-8777-777777777777" };
  const begun = await f.turns.beginTurn(identity, { userRequest: "大阪へ訂正", tripId: secondId });
  if (begun.state !== "started") throw new Error("unexpected turn state");
  await f.turns.acceptIntent(identity, begun.lease, { version: 1, mutationId: "intent-turn:replacement", baseIntentRevision: 1, speechAct: "correct", operations: [{
    operationId: "intent-op:replacement", groupId: "intent-group:replacement", action: "replace", target: "destination", scope: { type: "conversation" },
    modality: "required", precision: "exact", value: { kind: "place_label", label: "大阪" }, frame: "actual", provenance: { kind: "user_turn", turnId: identity.turnId, quote: "大阪" },
  }] });
  const application = new TripApplication(f.trips.repository, f.trips.repository, f.trips.clock, undefined, undefined, undefined, f.turns);
  await expect(application.execute(stateA, { version: "trip-api-v1", operation: "mutate", tripId: secondId, baseRevision: 0,
    mutationId: "88888888-8888-4888-8888-888888888888", proposal: f.proposal })).rejects.toMatchObject({ code: "conflict" });
  expect((await f.trips.repository.get(stateA, secondId))?.revision).toBe(0);
});

it("rejects a forged binding when no matching accepted Working State exists", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture(), turns = new DynamoDbConversationTurnRepository("test-state", state.client);
  await trips.repository.create(stateA, createTrip(secondId, "旅", "2026-09-14T00:00:00Z"));
  await state.conversations.create(stateA, conversationId, { ...stateMetadata(), tripId: secondId });
  // A complete end-to-end stale-binding case is covered above for production shape;
  // this negative asserts the writer does not fall back when no matching Working State exists.
  const proposal = { tripId: secondId, baseRevision: 0, summary: "偽造された古い案", patches: [{ type: "request" as const, request: { constraints: [], assumptions: [] } }],
    intentBinding: { version: "intent-proposal-binding-v1" as const, conversationId, intentRevision: 1, effectiveIntentFingerprint: "intent-1234abcd",
      changes: [{ changeRef: "old", groupRef: "old", action: "set" as const, target: "origin" as const, scope: { type: "conversation" as const } }] } };
  const application = new TripApplication(trips.repository, trips.repository, trips.clock, undefined, undefined, undefined, turns);
  await expect(application.execute(stateA, { version: "trip-api-v1", operation: "mutate", tripId: secondId, baseRevision: 0,
    mutationId: "55555555-5555-4555-8555-555555555555", proposal })).rejects.toMatchObject({ code: "conflict" });
  expect((await trips.repository.get(stateA, secondId))?.revision).toBe(0);
});

async function verifiedProposalFixture() {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await trips.repository.create(stateA, createTrip(secondId, "旅", "2026-09-14T00:00:00Z"));
  await state.conversations.create(stateA, conversationId, { ...stateMetadata(), tripId: secondId });
  const model: ConversationModel = { converse: vi.fn(async (request: ConversationModelRequest) => request.outputContract?.name === "conversation_semantic_delta"
    ? { message: { role: "assistant" as const, content: [{ text: JSON.stringify({ outcome: "delta", speechAct: "inform", operations: [
      { atomicGroup: 1, action: "set", target: "destination", modality: "required", precision: "exact", frame: "actual", quote: "京都", value: { kind: "place_label", label: "京都" } },
    ], unresolvedFragments: [] }) }] }, stopReason: "end_turn" as const, metadata: { modelId: "semantic", latencyMs: 1 } }
    : { message: { role: "assistant" as const, content: [{ text: JSON.stringify({ kind: "ask", responseText: "外部情報を調べてもよいですか？",
      missingRequirements: [{ action: "ask", field: "research_authorization", resolution: "authorization", reason: "許可を確認する" }] }) }] },
      stopReason: "end_turn" as const, metadata: { modelId: "answer", latencyMs: 1, outputMode: "application_strict" as const } }) };
  const agent = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model, weather: { search: vi.fn() }, semanticIntentEnabled: true, newExecutionId: () => "execution" });
  const result = await agent.runConversationTurn({ principal: stateA, conversationId, turnId: "99999999-9999-4999-8999-999999999999", userRequest: "京都へ行きたい" });
  return { state, trips, turns: new DynamoDbConversationTurnRepository("test-state", state.client), proposal: result.tripUpdateProposal! };
}
