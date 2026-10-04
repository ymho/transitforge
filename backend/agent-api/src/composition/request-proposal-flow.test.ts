import { expect, it, vi } from "vitest";
import { createTrip, type ItineraryItem } from "@raiquora/trip/trip";
import { projectDailyItinerary } from "@raiquora/trip/daily-itinerary";
import type { TripRequest } from "@raiquora/trip/trip-request";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { stateDynamoFixture, stateA, stateB, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { applicationProposalRuntime } from "./proposal-runtime.fixture.js";

const request: TripRequest = { constraints: [{ id: "pace", source: "assumption", strength: "soft", scope: { type: "trip" }, requirement: { type: "pace", value: 0.3 }, assumptionId: "a" }],
  assumptions: [{ id: "a", source: "model", status: "unconfirmed", text: "ゆっくり巡る仮置き", affects: [{ type: "constraint", constraintId: "pace" }] }] };
async function fixture(_withTrip = true, initialRequest?: TripRequest, items: readonly ItineraryItem[] = []) {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  const trip = createTrip(secondId, "同名の旅程", "2026-09-18T00:00:00Z", items, initialRequest);
  await trips.repository.create(stateA, trip);
  await state.conversations.create(stateA, conversationId, stateMetadata());
  const steps: Array<{ name: string; input: Record<string, unknown> }> = [{ name: "propose_request_assumptions", input: { request } }];
  const runRuntime = applicationProposalRuntime(() => steps[0]);
  const options = { stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client, runRuntime, weather: { search: vi.fn() }, newExecutionId: () => "execution" };
  const input = { principal: stateA, conversationId, turnId: secondId, userRequest: "ゆっくり巡りたい" };
  return { state, trips, trip, runRuntime, steps, options, input, app: createConversationServerAgent(options) };
}
it("binds model proposal to the authorized snapshot, persists/replays it, and leaves Trip/Profile unchanged", async () => {
  const f = await fixture(), before = structuredClone(f.trips.records);
  const result = await f.app.runConversationTurn(f.input);
  expect(result.tripUpdateProposal).toEqual({ tripId: secondId, baseRevision: 0, summary: "今回の旅行条件の仮置き案", patches: [{ type: "request", request }] });
  expect(f.trips.records).toEqual(before);
  expect(await f.state.profiles.get(stateA)).toBeUndefined();
  const history = await f.state.conversations.history(stateA, conversationId);
  expect(history.items[1].tripUpdateProposal).toEqual(result.tripUpdateProposal);
  expect(JSON.stringify(history)).not.toMatch(/toolUse|executionId|trace|principal/);
  expect(await createConversationServerAgent(f.options).runConversationTurn(f.input)).toEqual(result);
  expect(f.runRuntime).toHaveBeenCalledOnce();
  await expect(f.app.runConversationTurn({ ...f.input, principal: stateB })).rejects.toMatchObject({ code: "not-found" });
});
it("keeps an inspiration Trip as the proposal base while history revision changes", async () => {
  const original = { goal: "散策", constraints: [], assumptions: [] }, f = await fixture(true, original);
  f.steps[0] = { name: "propose_request_changes", input: { changes: [{ type: "set_goal", goal: "美術館", reason: "目的の変更案" }] } };
  const result = await f.app.runConversationTurn(f.input);
  expect(result.tripUpdateProposal).toMatchObject({ tripId: secondId, baseRevision: 0 });
  expect(result.consultationRequestProposal).toBeUndefined();
  expect((await f.trips.repository.get(stateA, secondId))?.request).toEqual(original);
  expect((await f.state.conversations.get(stateA, conversationId))?.revision).toBe(2);
  expect(await f.app.runConversationTurn(f.input)).toEqual(result);
});
it("persists and replays a reviewed replacement while retaining the original saved Trip", async () => {
  const original: TripRequest = { constraints: [{ id: "pace", source: "user", strength: "soft", scope: { type: "trip" }, requirement: { type: "pace", value: 0.7 } }], assumptions: [] };
  const f = await fixture(true, original);
  f.steps[0] = { name: "propose_request_changes", input: { changes: [{ type: "replace_constraint", constraintId: "pace", strength: "soft", requirement: { type: "pace", value: 0.2 }, reason: "ゆっくり巡る案" }] } };
  const result = await f.app.runConversationTurn(f.input);
  expect(result.tripUpdateProposal?.patches[0]).toMatchObject({ type: "request", request: { constraints: [{ id: "pace", source: "assumption", requirement: { type: "pace", value: 0.2 } }] } });
  expect((await f.trips.repository.get(stateA, secondId))?.request).toEqual(original);
  expect((await f.state.conversations.history(stateA, conversationId)).items[1].tripUpdateProposal).toEqual(result.tripUpdateProposal);
  expect(await f.app.runConversationTurn(f.input)).toEqual(result); expect(f.runRuntime).toHaveBeenCalledOnce();
});

it("retains an item preview in Trip conversation history without modifying the Trip", async () => {
  const shrine: ItineraryItem = { id: "shrine", title: "出雲大社", type: "activity", category: "sightseeing", schedule: { type: "day", date: "2026-10-01" } };
  const f = await fixture(true, undefined, [shrine]);
  f.steps[0] = { name: "propose_trip_item_change", input: {
    action: "add-activity", expectedRevision: 0, dayKey: projectDailyItinerary(f.trip).days[0]!.dayKey, afterId: "shrine", title: "昼食", category: "food", placeName: "出雲そば",
  } };
  const result = await f.app.runConversationTurn({ ...f.input, userRequest: "2日目の昼食に出雲そばを追加したい" });
  expect(result.tripUpdateProposal).toMatchObject({ tripId: secondId, baseRevision: 0 });
  expect(result.tripUpdateProposal?.patches[0]).toMatchObject({ type: "add", item: { category: "food", place: { name: "出雲そば", sources: [] } } });
  expect((await f.trips.repository.get(stateA, secondId))?.items).toEqual([shrine]);
  expect((await f.state.conversations.history(stateA, conversationId)).items[1].tripUpdateProposal).toEqual(result.tripUpdateProposal);
  expect(await f.app.runConversationTurn({ ...f.input, userRequest: "2日目の昼食に出雲そばを追加したい" })).toEqual(result);
});
