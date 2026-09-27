import { expect, it } from "vitest";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDbTripConsultationRepository } from "./dynamodb-trip-consultation-repository.js";
import { DynamoDbTripRepository } from "./dynamodb-trip-repository.js";
import { DynamoDbConversationRepository } from "./dynamodb-conversation-repository.js";
import { tripConsultationDynamoFixture } from "./trip-consultation-dynamo.fixture.js";
import { stateA, stateB } from "./state-dynamodb.fixture.js";
const input = { tripId: "75300000-0000-4000-8000-000000000001", title: "出雲大社に行きたい" };
function setup() {
  const f = tripConsultationDynamoFixture();
  const repository = () => new DynamoDbTripConsultationRepository("test-trips", "test-state", f.client, f.clock);
  const trips = new DynamoDbTripRepository("test-trips", f.client, f.clock), conversations = new DynamoDbConversationRepository("test-state", f.client, f.clock);
  return { ...f, repository, trips, conversations };
}
it("creates Trip, history, durable receipt and outbox together and reads both through normal repositories", async () => {
  const f = setup(), started = await f.repository().start(stateA, input);
  expect(started).toMatchObject({ conversationId: input.tripId, trip: { id: input.tripId, planningState: "inspiration", revision: 0, items: [] } });
  expect(await f.trips.get(stateA, input.tripId)).toEqual(started.trip);
  expect(await f.conversations.get(stateA, input.tripId)).toMatchObject({ conversationId: input.tripId, tripId: input.tripId, scope: "trip", messageCount: 0 });
  const writes = f.commands.filter(command => command instanceof TransactWriteItemsCommand);
  expect(writes).toHaveLength(1); expect((writes[0] as TransactWriteItemsCommand).input.TransactItems).toHaveLength(4);
  expect(await f.repository().start(stateA, input)).toEqual(started);
  expect(f.commands.filter(command => command instanceof TransactWriteItemsCommand)).toHaveLength(1);
});
it("a pre-commit failure creates neither resource; retry recovers with the same identity", async () => {
  const f = setup(); f.faults.beforeCommit = () => { throw new Error("storage unavailable"); };
  await expect(f.repository().start(stateA, input)).rejects.toMatchObject({ code: "unavailable" });
  expect(f.rows.size).toBe(0);
  await f.repository().start(stateA, input); expect(f.rows.size).toBe(4);
});
it("an ambiguous committed response never archives either resource or creates another history", async () => {
  const f = setup(); f.faults.loseResponse = true;
  const started = await f.repository().start(stateA, input);
  expect(await f.repository().start(stateA, input)).toEqual(started); expect(f.rows.size).toBe(4);
  expect((await f.conversations.history(stateA, input.tripId)).items).toEqual([]);
});
it("racing identical starts produce one Trip and one history; changed payload cannot overwrite them", async () => {
  const f = setup(); const [a,b] = await Promise.all([f.repository().start(stateA,input), f.repository().start(stateA,input)]);
  expect(a).toEqual(b); expect(f.rows.size).toBe(4);
  await expect(f.repository().start(stateA, { ...input, title: "別の旅" })).rejects.toMatchObject({ code: "mutation-reused" });
  expect((await f.trips.get(stateA,input.tripId))?.title).toBe(input.title);
});
it("keeps identical IDs isolated by verified owner and refuses malformed/forged starts before writing", async () => {
  const f = setup(); await f.repository().start(stateA,input);
  expect(await f.trips.get(stateB,input.tripId)).toBeUndefined(); expect(await f.conversations.get(stateB,input.tripId)).toBeUndefined();
  await f.repository().start(stateB,input); expect(f.rows.size).toBe(8);
  await expect(f.repository().start(undefined as never,input)).rejects.toMatchObject({ code: "unauthenticated" });
  await expect(f.repository().start(stateA, { ...input, tripId: "invalid" })).rejects.toMatchObject({ code: "invalid-input" });
});
it("a history tombstone or archived Trip is not resurrected on a later retry", async () => {
  for (const deleted of ["trip","history"]) {
    const f = setup(); await f.repository().start(stateA,input);
    const prefix = deleted === "trip" ? "test-trips/" : "test-state/";
    const row = [...f.rows.entries()].find(([key]) => key.startsWith(prefix) && key.endsWith(`/${deleted === "trip" ? "TRIP" : "TRIP_CONVERSATION"}#${input.tripId}`))![1];
    if (deleted === "trip") row.archived = { BOOL: true }; else row.deleted = { BOOL: true };
    await expect(f.repository().start(stateA,input)).rejects.toMatchObject({ code: "not-found" });
    expect(f.rows.size).toBe(4);
  }
});
