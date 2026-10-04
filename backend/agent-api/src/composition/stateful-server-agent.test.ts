import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import type { ServerAgentRuntimeInput } from "../ports/server-agent-runtime.js";
import { stateDynamoFixture, conversationId, secondId, stateMetadata, stateProfile } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { cognitoTokenFixture, token } from "../adapters/cognito-token.fixture.js";
import { createStatefulServerAgent } from "./stateful-server-agent.js";

it("verified principal → DynamoDB state → structured context → Server Runtime, without write-through", async () => {
  const { verifier } = cognitoTokenFixture(), a = await verifier.verify(token()), b = await verifier.verify(token({ sub: "user-b" }));
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await state.conversations.create(a, conversationId, { ...stateMetadata(), summary: "Aの会話要約" });
  await state.conversations.append(a, conversationId, 0, [{ role: "user", text: "以前の相談" }]);
  await state.profiles.put(a, { ...stateProfile(), usualOrigin: "Aの地域" }, null);
  await state.profiles.put(b, { ...stateProfile(), usualOrigin: "Bの地域" }, null);
  await trips.repository.create(a, { ...createTrip(secondId, "Aの旅程", "2026-09-18T00:00:00Z"), request: { goal: "今回の旅行目的", constraints: [], assumptions: [] } });
  const savedState = structuredClone(state.records), savedTrips = structuredClone(trips.records);
  const requests: ServerAgentRuntimeInput[] = [];
  const runRuntime = vi.fn(async (request: ServerAgentRuntimeInput) => {
    requests.push(request);
    return { status: "completed" as const, response: "こんにちは", evidence: [], claims: [],
      trace: { executionId: request.executionId, events: [], droppedEventCount: 0 } };
  });
  const app = createStatefulServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client,
    runRuntime, weather: { search: async () => { throw new Error("not used"); } }, newExecutionId: () => "turn" });
  const turn = { principal: a, userRequest: "続きを相談したい", conversationId };
  const result = await app.runAgentTurn({ ...turn, context: { travelProfile: { home: { area: "forged" } } }, ownerId: b.subject } as never);
  expect(result.status).toBe("completed");
  const context = { ...requests[0].context, userRequest: requests[0].userRequest };
  expect(context.userRequest).toBe(turn.userRequest);
  expect(context.conversation).toMatchObject({ summary: "Aの会話要約", messages: [{ role: "user", text: "以前の相談" }] });
  expect(context.travelProfile?.usualOrigin).toBe("Aの地域");
  expect(context.currentTrip?.title).toBe("Aの旅程");
  expect(context.currentTrip?.request?.goal).toBe("今回の旅行目的");
  expect(JSON.stringify(requests.map(({ context, userRequest }) => ({ context, userRequest })))).not.toMatch(/forged|Bの地域|identity-v1/);
  expect(JSON.stringify(result.trace)).not.toMatch(/以前の相談|Aの会話要約|Aの地域/);
  await app.runAgentTurn(turn); // A transport retry does not append either user or assistant text.
  expect(state.records).toEqual(savedState); expect(trips.records).toEqual(savedTrips);
  const calls = runRuntime.mock.calls.length;
  await expect(app.runAgentTurn({ ...turn, principal: b })).rejects.toMatchObject({ code: "not-found" });
  await expect(app.runAgentTurn({ principal: b, userRequest: "相談", tripId: secondId })).rejects.toMatchObject({ code: "not-found" });
  expect(runRuntime).toHaveBeenCalledTimes(calls);
  const bResult = await app.runAgentTurn({ principal: b, userRequest: "B-private-user-request" });
  const last = JSON.stringify(requests.at(-1)?.context);
  expect(last).toContain("Bの地域"); expect(last).not.toMatch(/Aの地域|Aの会話要約|Aの旅程|以前の相談/);
  expect(JSON.stringify(bResult.trace)).not.toContain("B-private-user-request");
  expect(requests.every((request) => !("trace" in request))).toBe(true);
  await Promise.all([app.runAgentTurn({ ...turn, userRequest: "parallel-A" }), app.runAgentTurn({ principal: b, userRequest: "parallel-B" })]);
  const concurrent = requests.slice(-2).map(({ context, userRequest }) => JSON.stringify({ context, userRequest }));
  expect(concurrent.find((request) => request.includes("parallel-A"))).toContain("Aの地域");
  expect(concurrent.find((request) => request.includes("parallel-A"))).not.toContain("Bの地域");
  expect(concurrent.find((request) => request.includes("parallel-B"))).toContain("Bの地域");
  expect(concurrent.find((request) => request.includes("parallel-B"))).not.toContain("Aの地域");
});
