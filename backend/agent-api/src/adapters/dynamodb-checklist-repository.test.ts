import { it, expect } from "vitest";
import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { checklistDynamoFixture } from "./checklist-dynamodb.fixture.js";
import { DynamoDbChecklistRepository } from "./dynamodb-checklist-repository.js";
import { checklistItem } from "../../../../modules/trip/domain/trip-checklist.fixture.js";

const owner = { subject: "owner-A" };
it("fails closed on corrupt/unscoped records, cross-owner cursors and changing collection reads", async () => {
  const f = checklistDynamoFixture(), item = checklistItem(); await f.checklist.commit(owner, item.tripId, 0, [{ item }]);
  const key = `OWNER#owner-A/CHECKLIST#${item.tripId}#${item.id}`, raw = structuredClone(f.records.get(key)!);
  f.records.set(key, { ...raw, checklist: { S: JSON.stringify({ ...item, privatePayload: "never accept" }) } });
  await expect(f.checklist.read(owner, item.tripId)).rejects.toMatchObject({ code: "unavailable" }); f.records.set(key, raw);
  const corruptCursor = new DynamoDbChecklistRepository("test-trips", { async send(command) {
    if (command instanceof QueryCommand) return { Items: [], LastEvaluatedKey: { pk: { S: "OWNER#other" }, sk: raw.sk! } };
    return f.client.send(command);
  } });
  await expect(corruptCursor.read(owner, item.tripId)).rejects.toMatchObject({ code: "unavailable" });
  let versions = 0;
  const changing = new DynamoDbChecklistRepository("test-trips", { async send(command) {
    const result = await f.client.send(command);
    if (command instanceof GetItemCommand && ++versions === 2 && result.Item) result.Item.version = { N: "2" };
    return result;
  } });
  await expect(changing.read(owner, item.tripId)).rejects.toMatchObject({ code: "conflict" });
});
it("rejects invalid batch/foreign Trip/item revisions before any transaction", async () => {
  const f = checklistDynamoFixture(), item = checklistItem();
  for (const writes of [[{ item: { ...item, tripId: item.id } }], [{ item, baseRevision: 5 }], Array(13).fill({ item })]) {
    await expect(f.checklist.commit(owner, item.tripId, 0, writes)).rejects.toMatchObject({ code: "invalid-input" });
  }
  expect(f.commands).toHaveLength(0); expect(f.records.size).toBe(0);
});
