import { strandsScriptedRuntime } from "../../backend/agent-api/src/adapters/strands-scripted-model.fixture.js";
import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createProductionAgentStream } from "../../backend/agent-api/src/agent-stream-composition.js";
import { createProductionConversationAgent } from "../../backend/agent-api/src/composition/production-conversation-agent.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata } from "../../backend/agent-api/src/adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../../backend/agent-api/src/adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../../backend/agent-api/src/adapters/cognito-token.fixture.js";
import { consumeAgentStream } from "../../frontend/src/adapters/http/agent-stream/consumer.js";
import type { ConversationTurnResult } from "../../backend/agent-api/src/ports/conversation-turn-repository.js";
import { ConversationTurnExecutionError } from "../../backend/agent-api/src/usecases/agent/conversation-turn.js";

it("the real Browser consumer accepts a persisted Runtime answer and its replay", async () => {
  const { verifier } = cognitoTokenFixture(), state = stateDynamoFixture(), trips = tripDynamoFixture();
  const principal = await verifier.verify(token());
  trips.seed(createTrip(secondId, "検討中の旅", "2026-09-27T00:00:00Z"), principal.subject);
  await state.conversations.create(principal, conversationId, stateMetadata());
  const { model, runRuntime } = strandsScriptedRuntime([
    { name: "strands_structured_output", input: { reply: { kind: "conversation", message: "acknowledgement", text: "散策の希望を確認しました。" } } },
  ]);
  const handle = createProductionAgentStream({ enabled: true, path: "/api/agent-stream", verifier, log: () => {},
    newExecutionId: () => "wire-test", createApplication: executionId => createProductionConversationAgent({
      stateTable: "test-state", stateClient: state.client, tripTable: "test-trips", tripClient: trips.client,
      newExecutionId: () => executionId, runRuntime, weather: { search: vi.fn() },
    }) });
  for (let attempt = 0; attempt < 2; attempt++) {
    const frames: string[] = [], onEvent = vi.fn();
    await handle({ method: "POST", path: "/api/agent-stream",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      body: JSON.stringify({ conversationId, turnId: secondId, userRequest: "歴史ある街を歩きたい" }),
    }, { signal: new AbortController().signal, start: (status) => { expect(status).toBe(200); },
      write: async frame => { frames.push(frame); }, end: async () => {} });
    await consumeAgentStream({ token: "fixture", request: { userRequest: "歴史ある街を歩きたい" },
      signal: new AbortController().signal, isCurrent: () => true, onEvent,
      measurement: { requestStart: 0, maxSilenceMs: 0 },
      fetcher: async () => new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } }),
    });
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type: "final", response: "散策の希望を確認しました。" }));
    expect(frames.join("")).not.toMatch(/turnObservation|presentationReceipt/);
  }
  expect(model.calls).toBe(1);
});

it.each(["completed", "follow_up"] as const)("projects only public fields from a stored %s result", async status => {
  const result: ConversationTurnResult & { internalDebug: string } = { status, response: "確認済みの回答",
    turnObservation: { outcome: "answer", progress: [] },
    presentationReceipt: { presentationId: "receipt", version: 1, entries: [] }, internalDebug: "PRIVATE" };
  const { verifier } = cognitoTokenFixture(), frames: string[] = [], onEvent = vi.fn();
  const handle = createProductionAgentStream({ enabled: true, path: "/api/agent-stream", verifier, log: () => {},
    newExecutionId: () => "wire-test", createApplication: () => ({ runConversationTurn: async () => result }) });
  await handle({ method: "POST", path: "/api/agent-stream",
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: JSON.stringify({ conversationId, turnId: secondId, userRequest: "旅行相談" }),
  }, { signal: new AbortController().signal, start: () => {}, write: async frame => { frames.push(frame); }, end: async () => {} });
  await consumeAgentStream({ token: "fixture", request: { userRequest: "旅行相談" }, signal: new AbortController().signal,
    isCurrent: () => true, onEvent, measurement: { requestStart: 0, maxSilenceMs: 0 },
    fetcher: async () => new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } }) });
  expect(onEvent).toHaveBeenLastCalledWith({ type: "final", status, response: "確認済みの回答" });
  expect(frames.join("")).not.toMatch(/turnObservation|presentationReceipt|internalDebug|PRIVATE/);
});

it.each(["agent_failed", "limit_reached"] as const)("does not disguise a real %s as a successful answer", async code => {
  const { verifier } = cognitoTokenFixture(), frames: string[] = [], onEvent = vi.fn();
  const handle = createProductionAgentStream({ enabled: true, path: "/api/agent-stream", verifier, log: () => {},
    newExecutionId: () => "wire-test", createApplication: () => ({ runConversationTurn: async () => { throw new ConversationTurnExecutionError(code); } }) });
  await handle({ method: "POST", path: "/api/agent-stream",
    headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: JSON.stringify({ conversationId, turnId: secondId, userRequest: "旅行相談" }),
  }, { signal: new AbortController().signal, start: () => {}, write: async frame => { frames.push(frame); }, end: async () => {} });
  await expect(consumeAgentStream({ token: "fixture", request: { userRequest: "旅行相談" }, signal: new AbortController().signal,
    isCurrent: () => true, onEvent, measurement: { requestStart: 0, maxSilenceMs: 0 },
    fetcher: async () => new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } }) })).rejects.toThrow(code);
  expect(onEvent.mock.calls.some(([event]) => event.type === "final")).toBe(false);
});
