import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import type { ServerAgentRuntimeInput } from "../ports/server-agent-runtime.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata, stateProfile } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import type { ServerAgentRuntimeRunner } from "../ports/server-agent-runtime.js";
import type { Evidence } from "@raiquora/agent/evidence-model";

it("verified principal → idempotent messages → stateful Server Runtime → persisted final replay", async () => {
  const { verifier } = cognitoTokenFixture();
  const a = await verifier.verify(token()), b = await verifier.verify(token({ sub: "user-b" }));
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await state.conversations.create(a, conversationId, stateMetadata());
  await state.conversations.append(a, conversationId, 0, [{ role: "user", text: "以前の相談" }]);
  await state.profiles.put(a, { ...stateProfile(), usualOrigin: "Aの地域" }, null);
  await trips.repository.create(a, createTrip(secondId, "Aの旅程", "2026-09-18T00:00:00Z"));
  const originalProfile = await state.profiles.get(a), originalTrips = structuredClone(trips.records);
  const requests: ServerAgentRuntimeInput[] = [];
  const runRuntime = vi.fn(async (request: ServerAgentRuntimeInput) => {
    requests.push(request); request.researchLedger.reserve("modelCalls");
    return { status: "completed" as const, response: "こんにちは", evidence: [], claims: [],
      trace: { executionId: request.executionId, events: [], droppedEventCount: 0 } };
  });
  const options = { stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    runRuntime, weather: { search: async () => { throw new Error("not used"); } }, newExecutionId: () => "runtime-execution" };
  const app = createConversationServerAgent(options);
  const turn = { principal: a, userRequest: "続きを相談したい", conversationId, turnId: secondId };
  const result = await app.runConversationTurn(turn);
  expect(result).toMatchObject({ status: "completed", response: "こんにちは", researchExecution: {
    version: "research-execution-v1", policyVersion: "standard-v1", status: "completed",
    usage: { modelCalls: 1, toolCalls: 0, saveCalls: 1, measurementCoverage: { providerReads: false, saveCalls: true } },
  } });
  const context = { ...requests[0].context, userRequest: requests[0].userRequest };
  expect(context.userRequest).toBe(turn.userRequest);
  expect(context.conversation?.messages).toEqual([{ role: "user", text: "以前の相談" }]);
  expect(context.travelProfile?.usualOrigin).toBe("Aの地域");
  expect(context.currentTrip?.title).toBe("Aの旅程");
  expect(requests[0]).not.toHaveProperty("trace");
  expect(await createConversationServerAgent(options).runConversationTurn(turn)).toEqual(result);
  expect(runRuntime).toHaveBeenCalledTimes(1);
  expect((await state.conversations.history(a, conversationId)).items.map((m) => m.text)).toEqual(["以前の相談", turn.userRequest, result.response]);
  expect(await state.profiles.get(a)).toEqual(originalProfile); expect(trips.records).toEqual(originalTrips);
  await expect(app.runConversationTurn({ ...turn, principal: b })).rejects.toMatchObject({ code: "not-found" });
  await expect(app.runConversationTurn({ ...turn, ownerId: b.subject } as never)).rejects.toMatchObject({ code: "invalid-input" });
  expect(runRuntime).toHaveBeenCalledTimes(1);
});

it("runs the production-shaped Conversation state path through the trusted Strands Runtime seam", async () => {
  const { verifier } = cognitoTokenFixture();
  const principal = await verifier.verify(token()), other = await verifier.verify(token({ sub: "user-b" }));
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const consultationMetadata = stateMetadata();
  trips.seed(createTrip(stateMetadata().tripId, "検討中の旅", "2026-09-18T00:00:00Z"), principal.subject);
  await state.conversations.create(principal, conversationId, consultationMetadata);
  const evidence: Evidence = {
    id: "evidence:conversation:kyoto",
    category: "external",
    knowledgeKind: "deterministic_fact",
    subject: "京都",
    facts: { status: "available", freshness: "fresh", sourceTitle: "京都の確認済み資料",
      sourceExcerpt: "京都について会話で公開済みの確認済み資料です。", sourceUrl: "https://example.test/kyoto" },
    references: [{ sourceType: "external-source", sourceRef: "https://example.test/kyoto", retrievedAt: "2026-09-26T00:00:00.000Z",
      freshness: "current", summary: "会話で確認済みの京都に関する根拠" }],
    observation: { observationId: "evidence:conversation:kyoto", subjectKey: "place:kyoto", scopeKey: "conversation",
      predicate: "place_description", retrievedAt: "2026-09-26T00:00:00.000Z", applicability: "applicable", retention: "bounded_excerpt" },
  };
  const calls: Parameters<ServerAgentRuntimeRunner>[0][] = [];
  const runtimeImplementation: ServerAgentRuntimeRunner = async (input) => {
    calls.push(input);
    const published: Evidence[] = calls.length === 1 ? [evidence] : [...(input.initialEvidence ?? [])];
    return {
      status: "completed",
      response: calls.length === 1 ? "Strands first answer" : "Strands second answer",
      evidence: published,
      claims: published.map((item, index) => ({
        id: `claim-${index}`,
        statement: "確認済みの根拠です",
        kind: "fact",
        evidenceIds: [item.id],
        bindings: [{
          evidenceId: item.id,
          fieldPath: "facts.status",
          subjectRef: item.observation?.subjectKey ?? item.subject,
          transform: "identity",
        }],
        groundingStatus: "supported",
        missingEvidenceIds: [],
      })),
      trace: { executionId: input.executionId, events: [], droppedEventCount: 0 },
      delivery: { status: "full", basis: "verified_projection" },
    };
  };
  const runRuntime = vi.fn(runtimeImplementation);
  const app = createConversationServerAgent({
    stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    weather: { search: async () => { throw new Error("not used"); } },
    newExecutionId: () => `strands-${calls.length + 1}`, runRuntime,
  });
  const firstTurn = { principal, conversationId, turnId: secondId, userRequest: "京都について続けて" };
  const first = await app.runConversationTurn(firstTurn);
  expect(first).toMatchObject({ status: "completed", response: "Strands first answer",
    delivery: { status: "full", basis: "verified_projection" } });
  expect(runRuntime).toHaveBeenCalledTimes(1);

  const replay = await createConversationServerAgent({
    stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    weather: { search: async () => { throw new Error("not used"); } },
    newExecutionId: () => "must-not-run", runRuntime,
  }).runConversationTurn(firstTurn);
  expect(replay).toEqual(first);
  expect(runRuntime).toHaveBeenCalledTimes(1);

  const nextTurn = { ...firstTurn, turnId: "33333333-3333-4333-8333-333333333333", userRequest: "その根拠を踏まえて続けて" };
  const second = await app.runConversationTurn(nextTurn);
  expect(second.response).toBe("Strands second answer");
  expect(runRuntime).toHaveBeenCalledTimes(2);
  expect(calls[1]?.initialEvidence?.map(({ id }) => id)).toEqual([evidence.id]);

  const callsBeforeForeign = calls.length;
  await expect(app.runConversationTurn({ ...nextTurn, principal: other,
    turnId: "44444444-4444-4444-8444-444444444444" })).rejects.toMatchObject({ code: "not-found" });
  expect(calls).toHaveLength(callsBeforeForeign);
});
