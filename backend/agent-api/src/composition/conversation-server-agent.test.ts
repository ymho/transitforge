import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import type { ConversationModelRequest } from "../ports/conversation-model.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata, stateProfile } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";

it("verified principal → idempotent messages → stateful Server Runtime → persisted final replay", async () => {
  const { verifier } = cognitoTokenFixture();
  const a = await verifier.verify(token()), b = await verifier.verify(token({ sub: "user-b" }));
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await state.conversations.create(a, conversationId, stateMetadata());
  await state.conversations.append(a, conversationId, 0, [{ role: "user", text: "以前の相談" }]);
  await state.profiles.put(a, { ...stateProfile(), home: { area: "Aの地域" } }, null);
  await trips.repository.create(a, createTrip(secondId, "Aの旅程", "2026-09-18T00:00:00Z"));
  const originalProfile = await state.profiles.get(a), originalTrips = structuredClone(trips.records);
  const requests: ConversationModelRequest[] = [];
  const model = { converse: vi.fn(async (request: ConversationModelRequest) => {
    requests.push(structuredClone(request));
    return { message: { role: "assistant" as const, content: [{ text: "こんにちは" }] }, stopReason: "end_turn" as const, metadata: { modelId: "test", latencyMs: 1 } };
  }) };
  const options = { stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model, weather: { search: async () => { throw new Error("not used"); } }, newExecutionId: () => "runtime-execution" };
  const app = createConversationServerAgent(options);
  const turn = { principal: a, userRequest: "続きを相談したい", conversationId, turnId: secondId };
  const result = await app.runConversationTurn(turn);
  expect(result).toMatchObject({ status: "completed", response: "こんにちは", researchExecution: {
    version: "research-execution-v1", policyVersion: "standard-v1", status: "completed",
    usage: { modelCalls: 1, toolCalls: 0, saveCalls: 1, measurementCoverage: { providerReads: false, saveCalls: true } },
  } });
  const text = requests[0].messages[0].content.find((block) => "text" in block)!;
  const context = JSON.parse(("text" in text ? text.text : "").match(/<agent_context>([\s\S]*)<\/agent_context>/)![1]);
  expect(context.userRequest).toBe(turn.userRequest);
  expect(context.conversation.messages).toEqual([{ role: "user", text: "以前の相談" }]);
  expect(context.travelProfile.home.area).toBe("Aの地域");
  expect(context.currentTrip.title).toBe("Aの旅程");
  expect(requests[0].trace).toBeUndefined();
  expect(await createConversationServerAgent(options).runConversationTurn(turn)).toEqual(result);
  expect(model.converse).toHaveBeenCalledTimes(1);
  expect((await state.conversations.history(a, conversationId)).items.map((m) => m.text)).toEqual(["以前の相談", turn.userRequest, result.response]);
  expect(await state.profiles.get(a)).toEqual(originalProfile); expect(trips.records).toEqual(originalTrips);
  await expect(app.runConversationTurn({ ...turn, principal: b })).rejects.toMatchObject({ code: "not-found" });
  await expect(app.runConversationTurn({ ...turn, ownerId: b.subject } as never)).rejects.toMatchObject({ code: "invalid-input" });
  expect(model.converse).toHaveBeenCalledTimes(1);
});
