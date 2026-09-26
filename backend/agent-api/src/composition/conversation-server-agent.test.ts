import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import type { ConversationModelRequest } from "../ports/conversation-model.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata, stateProfile } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { DynamoDbConversationTurnRepository } from "../adapters/dynamodb-conversation-turn-repository.js";
import type { ServerAgentRuntimeRunner } from "../ports/server-agent-runtime.js";
import type { Evidence } from "@raiquora/agent/evidence-model";

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

it("runs natural language through semantic acceptance before Runtime", async () => {
  const { verifier } = cognitoTokenFixture(); const principal = await verifier.verify(token());
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const { tripId: _tripId, ...consultationMetadata } = stateMetadata();
  await state.conversations.create(principal, conversationId, consultationMetadata);
  const requests: ConversationModelRequest[] = [];
  const model = { converse: vi.fn(async (request: ConversationModelRequest) => {
    requests.push(structuredClone(request));
    if (request.outputContract?.name === "conversation_semantic_delta") {
      return { message: { role: "assistant" as const, content: [{ text: JSON.stringify({ outcome: "delta", speechAct: "inform", operations: [
        { atomicGroup: 1, action: "set", target: "destination", modality: "preferred", precision: "exact", frame: "actual", quote: "出雲大社", value: { kind: "place_label", label: "出雲大社" } },
        { atomicGroup: 1, action: "set", target: "start_date", modality: "required", precision: "exact", frame: "actual", quote: "明日出発", value: { kind: "relative_date", relation: "tomorrow" } },
      ], unresolvedFragments: [] }) }] },
        stopReason: "end_turn" as const, metadata: { modelId: "decision", latencyMs: 1 } };
    }
    return { message: { role: "assistant" as const, content: [{ text: JSON.stringify({ kind: "ask", responseText: "外部の最新情報を調べてもよいですか？",
      missingRequirements: [{ action: "ask", field: "research_authorization", resolution: "authorization", reason: "外部調査の許可を確認する" }] }) }] },
      stopReason: "end_turn" as const, metadata: { modelId: "answer", latencyMs: 1, outputMode: "application_strict" as const } };
  }) };
  const app = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model, weather: { search: async () => { throw new Error("not used"); } }, semanticIntentEnabled: true, newExecutionId: () => "runtime-execution" });
  const result = await app.runConversationTurn({ principal, conversationId, turnId: "11111111-1111-4111-8111-111111111111", userRequest: "出雲大社へ明日出発します", uiContext: { calendarDate: "2026-09-25" } });
  expect(result.consultationRequestProposal).toMatchObject({ conversationId, baseRequest: { constraints: [], assumptions: [] },
    request: { constraints: [
      { source: "user", requirement: { type: "dates", start: { earliest: "2026-09-26", latest: "2026-09-26" } } },
      { source: "user", requirement: { type: "destinations", places: [{ name: "出雲大社", sources: [] }] } },
    ], assumptions: [] }, intentBinding: { version: "intent-proposal-binding-v1", intentRevision: 1, changes: [
      { target: "destination" }, { target: "start_date" },
    ] } });
  const working = await new DynamoDbConversationTurnRepository("test-state", state.client).getWorkingState(principal, conversationId);
  expect(working?.semantic?.overlay).toMatchObject({ intentRevision: 1, facts: [
    { target: "destination", value: { kind: "place_label", label: "出雲大社" } },
    { target: "start_date", value: { kind: "local_date", date: "2026-09-26", expression: "tomorrow",
      anchorDate: "2026-09-25", resolverVersion: "calendar-v1" } },
  ] });
  const runtimeRequests = requests.filter(({ outputContract }) => outputContract?.name !== "conversation_semantic_delta");
  const contextBlock = runtimeRequests[0]!.messages[0]!.content.find((block) => "text" in block) as { text: string };
  const context = JSON.parse(contextBlock.text.match(/<agent_context>([\s\S]*)<\/agent_context>/)![1]);
  expect(context.workingState.semantic).toBeUndefined();
  expect(context.effectiveIntent.actualConversationFacts.map((fact: { target: string }) => fact.target)).toEqual(["destination", "start_date"]);
  expect(context.effectiveIntent).toMatchObject({ intentRevision: 1, profileHints: [], hypotheticalFacts: [] });
  expect(context.taskContext.currentIntentChange).toEqual({ intentRevision: 1, speechAct: "inform", operations: [
    { action: "set", target: "destination", frame: "actual" }, { action: "set", target: "start_date", frame: "actual" },
  ] });
  expect(requests.filter(({ outputContract }) => outputContract?.name === "conversation_semantic_delta")).toHaveLength(1);
});


it("runs the production-shaped Conversation state path through the trusted Strands Runtime seam", async () => {
  const { verifier } = cognitoTokenFixture();
  const principal = await verifier.verify(token()), other = await verifier.verify(token({ sub: "user-b" }));
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const { tripId: _tripId, ...consultationMetadata } = stateMetadata();
  await state.conversations.create(principal, conversationId, consultationMetadata);
  const evidence: Evidence = {
    id: "evidence:conversation:kyoto",
    category: "station",
    knowledgeKind: "deterministic_fact",
    subject: "京都",
    facts: { status: "available" },
    references: [{ sourceType: "session-state", sourceRef: "conversation:kyoto", retrievedAt: "2026-09-26T00:00:00.000Z",
      freshness: "current", summary: "会話で確認済みの京都に関する根拠" }],
    observation: { observationId: "evidence:conversation:kyoto", subjectKey: "conversation:kyoto", scopeKey: "conversation",
      predicate: "destination", retrievedAt: "2026-09-26T00:00:00.000Z", applicability: "applicable", retention: "reference_only" },
  };
  const calls: Parameters<ServerAgentRuntimeRunner>[0][] = [];
  const runRuntime: ServerAgentRuntimeRunner = vi.fn(async input => {
    calls.push(input);
    const published = calls.length === 1 ? [evidence] : input.initialEvidence ?? [];
    return {
      status: "completed",
      response: calls.length === 1 ? "Strands first answer" : "Strands second answer",
      evidence: published,
      claims: published.map((item, index) => ({ id: `claim-${index}`, statement: "確認済みの根拠です", kind: "fact" as const,
        evidenceIds: [item.id], bindings: [{ evidenceId: item.id, fieldPath: "facts.status",
          subjectRef: item.observation?.subjectKey ?? item.subject, transform: "identity" as const }] })),
      trace: { executionId: input.executionId, events: [], droppedEventCount: 0 },
      delivery: { status: "full", basis: "verified_projection" },
    };
  });
  const model = { converse: vi.fn(async () => { throw new Error("V1 model must not run"); }) };
  const app = createConversationServerAgent({
    stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model, weather: { search: async () => { throw new Error("not used"); } },
    newExecutionId: () => `strands-${calls.length + 1}`, runRuntime,
  });
  const firstTurn = { principal, conversationId, turnId: secondId, userRequest: "京都について続けて" };
  const first = await app.runConversationTurn(firstTurn);
  expect(first).toMatchObject({ status: "completed", response: "Strands first answer",
    delivery: { status: "full", basis: "verified_projection" } });
  expect(runRuntime).toHaveBeenCalledTimes(1);
  expect(model.converse).not.toHaveBeenCalled();

  const replay = await createConversationServerAgent({
    stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    model, weather: { search: async () => { throw new Error("not used"); } },
    newExecutionId: () => "must-not-run", runRuntime,
  }).runConversationTurn(firstTurn);
  expect(replay).toEqual(first);
  expect(runRuntime).toHaveBeenCalledTimes(1);

  const nextTurn = { ...firstTurn, turnId: "33333333-3333-4333-8333-333333333333", userRequest: "その根拠を踏まえて続けて" };
  const second = await app.runConversationTurn(nextTurn);
  expect(second.response).toBe("Strands second answer");
  expect(runRuntime).toHaveBeenCalledTimes(2);
  expect(calls[1]?.initialEvidence?.map(({ id }) => id)).toEqual([evidence.id]);
  expect(calls[1]?.context?.workingState?.groundingEvidence).toBeUndefined();

  const callsBeforeForeign = calls.length;
  await expect(app.runConversationTurn({ ...nextTurn, principal: other,
    turnId: "44444444-4444-4444-8444-444444444444" })).rejects.toMatchObject({ code: "not-found" });
  expect(calls).toHaveLength(callsBeforeForeign);
  expect(model.converse).not.toHaveBeenCalled();
});
