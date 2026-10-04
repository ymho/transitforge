import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createConversationServerAgent } from "./conversation-server-agent.js";
import { stateDynamoFixture, stateA, stateB, conversationId, secondId, stateMetadata } from "../adapters/state-dynamodb.fixture.js";
import { tripDynamoFixture } from "../adapters/trip-dynamodb.fixture.js";
import { applicationProposalRuntime } from "./proposal-runtime.fixture.js";

it("does not expose the retired AI cost forecast tool or write estimates through it", async () => {
  const state = stateDynamoFixture(), trips = tripDynamoFixture();
  await trips.repository.create(stateA, createTrip(secondId, "旅行", "2026-09-01T00:00:00Z"));
  await state.conversations.create(stateA, conversationId, stateMetadata());
  const runRuntime = applicationProposalRuntime(() => ({ name: "propose_trip_costs", input: {} }));
  const agent = createConversationServerAgent({ stateTable: "test-state", tripTable: "test-trips", stateClient: state.client, tripClient: trips.client, runRuntime, weather: { search: vi.fn() } });
  await expect(agent.runConversationTurn({ principal: stateA, conversationId, turnId: secondId, userRequest: "費用を概算して" })).rejects.toThrow();
  expect((await trips.repository.get(stateA, secondId))?.costs).toBeUndefined();
});

it("persists the first per-item estimate through the authorized CAS writer and rereads it", async () => {
  const { TripApplication } = await import("../usecases/trip-application.js");
  const { tripApiVersion } = await import("../contracts/trip-api.js");
  const { editItemCost, itemCost } = await import("@raiquora/trip/item-cost");
  const f = tripDynamoFixture();
  const trip = createTrip(secondId, "旅行", "2026-09-01T00:00:00Z", [{ id: "food", title: "食事", type: "activity", category: "food", schedule: { type: "unscheduled" } }]);
  await f.repository.create(stateA, trip);
  const app = new TripApplication(f.repository, f.repository, f.clock);
  const command = { version: tripApiVersion, operation: "mutate", tripId: trip.id, baseRevision: 0, mutationId: conversationId,
    proposal: { tripId: trip.id, baseRevision: 0, summary: "概算費用", patches: [editItemCost(trip, "food", { currency: "JPY", amountMinor: 1500 })] } };
  const result = await app.execute(stateA, command);
  expect(await app.execute(stateA, command)).toEqual(result);
  const saved = await f.repository.get(stateA, trip.id);
  expect(saved?.revision).toBe(1); expect(saved?.costs?.forecast).toBeUndefined();
  expect(itemCost(saved!, saved!.items[0]!)?.amount.amountMinor).toBe(1500);
  expect(await f.repository.get(stateB, trip.id)).toBeUndefined();
  await expect(app.execute(stateA, { ...command, mutationId: "33333333-3333-4333-8333-333333333333" })).rejects.toMatchObject({ code: "conflict" });
});
