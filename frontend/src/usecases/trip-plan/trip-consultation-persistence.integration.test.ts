import { expect, it, vi } from "vitest";
import type { Trip } from "@raiquora/trip/trip";
import { startTripConsultation } from "./start-trip-consultation";
import { HttpServerTripClient } from "../../adapters/http/server-trip-client";
import { HttpServerConversationClient } from "../../adapters/http/server-conversation-client";
import { ConversationUiController } from "../personal-state/conversation-ui-controller";
import { createTripApiHandler } from "../../../../backend/agent-api/src/trip-handler";
import { createConversationApiHandler } from "../../../../backend/agent-api/src/server-state-handler";
import { TripApplication } from "../../../../backend/agent-api/src/usecases/trip-application";
import { ConversationApplication } from "../../../../backend/agent-api/src/usecases/conversation-application";
import { DynamoDbTripRepository } from "../../../../backend/agent-api/src/adapters/dynamodb-trip-repository";
import { DynamoDbTripConsultationRepository } from "../../../../backend/agent-api/src/adapters/dynamodb-trip-consultation-repository";
import { DynamoDbConversationRepository } from "../../../../backend/agent-api/src/adapters/dynamodb-conversation-repository";
import { createProductionConversationAgent } from "../../../../backend/agent-api/src/composition/production-conversation-agent";
import { tripConsultationDynamoFixture } from "../../../../backend/agent-api/src/adapters/trip-consultation-dynamo.fixture";
import { stateA, noCandidateResources } from "../../../../backend/agent-api/src/adapters/state-dynamodb.fixture";
const tripId = "75300000-0000-4000-8000-000000000001";

it("runs HTTP clients → authenticated applications → atomic storage → Agent/history → reload with one Trip", async () => {
  const f = tripConsultationDynamoFixture();
  const repository = new DynamoDbTripRepository("test-trips",f.client,f.clock);
  const conversations = new DynamoDbConversationRepository("test-state",f.client,f.clock);
  const application = new TripApplication(repository,repository,f.clock,undefined,undefined,undefined,undefined,
    new DynamoDbTripConsultationRepository("test-trips","test-state",f.client,f.clock));
  // The identity here is the same verified-result fixture as the repositories.
  // Signed JWT/forged identity rejection is separately exercised at the HTTP boundary.
  const tripHandler = createTripApiHandler(application,{ authenticate: async () => stateA });
  const conversationHandler = createConversationApiHandler(new ConversationApplication(conversations,noCandidateResources,undefined,repository),async () => stateA);
  let loseStartResponse = true;
  const request: typeof fetch = async (url, options) => {
    const path = String(url), body = String(options?.body);
    const event = { rawPath: path, httpMethod: "POST", headers: {}, body };
    const result = await (path === "/api/trips/v1" ? tripHandler : conversationHandler)(event);
    if (loseStartResponse && JSON.parse(body).operation === "start-consultation") { loseStartResponse = false; throw new Error("response lost"); }
    return new Response(result.body,{ status: result.statusCode, headers: { "content-type": "application/json" } });
  };
  const trips = new HttpServerTripClient("/api/trips/v1",request);
  const client = new HttpServerConversationClient("/api/conversations/v1",request);
  const ui = new ConversationUiController(client);
  let current: Trip | undefined;
  const runRuntime = vi.fn(async (input: Parameters<NonNullable<Parameters<typeof createProductionConversationAgent>[0]["runRuntime"]>>[0]) => {
    expect(input.context?.currentTrip?.tripId).toBe(tripId);
    expect(input.context?.taskContext?.phase).toBe("discovery");
    expect(input.context?.consultationRequest).toBeUndefined();
    return { status: "completed" as const, response: "画面接続検証用の回答", evidence: [], claims: [],
      trace: { executionId: input.executionId, events: [], droppedEventCount: 0 } };
  });
  const agent = createProductionConversationAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: f.client, tripClient: f.client,
    runRuntime, model: { converse: vi.fn(async () => { throw new Error("V1 must not run"); }) }, weather: { search: vi.fn() } });
  let answer: ReturnType<typeof agent.runConversationTurn> | undefined;
  const start = () => startTripConsultation({ prompt: "出雲大社に行きたい", tripId, isCurrent: () => true,
    start: value => trips.startConsultation(value),
    activate: async (conversationId,target) => {
      const session = await ui.findForTrip(target); expect(session?.id).toBe(conversationId);
      ui.selectLocal(conversationId); await ui.loadHistory(conversationId); current = await trips.get(target);
    },
    current: () => ({ conversationId: ui.active()?.id ?? "", tripId: current?.id }),
    submit: prompt => { answer = agent.runConversationTurn({ principal: stateA, conversationId: tripId, tripId,
      turnId: "75300000-0000-4000-8000-000000000010", userRequest: prompt }); },
  });
  await expect(start()).rejects.toThrow("response lost"); expect(runRuntime).not.toHaveBeenCalled();
  expect((await trips.list()).trips).toHaveLength(1);
  await start(); await answer;
  expect(runRuntime).toHaveBeenCalledOnce();
  expect((await trips.list()).trips).toHaveLength(1);
  const messages = await ui.loadHistory(tripId);
  expect(messages).toHaveLength(2); expect(messages[0]).toMatchObject({ role: "user", text: "出雲大社に行きたい" });
  expect(messages[1]).toMatchObject({ role: "assistant", response: "画面接続検証用の回答" });
  // Persist an explicit user change via the normal revision-bound Trip writer.
  const saved = await trips.mutate({ tripId, baseRevision: current!.revision, mutationId: "75300000-0000-4000-8000-000000000020",
    proposal: { tripId, baseRevision: current!.revision, summary: "旅程名を変更", patches: [{ type: "title", title: "出雲の旅" }] } });
  expect(saved.title).toBe("出雲の旅");
  // A new controller instance represents page reload: no local storage/import/fallback.
  const reloaded = new ConversationUiController(new HttpServerConversationClient("/api/conversations/v1",request));
  const session = await reloaded.findForTrip(tripId); expect(session?.tripId).toBe(tripId);
  reloaded.selectLocal(session!.id); expect(await reloaded.loadHistory(session!.id)).toEqual(messages);
  expect((await trips.get(tripId))?.title).toBe("出雲の旅");
  expect((await client.list()).items).toHaveLength(1);
});
