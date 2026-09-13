import { expect } from "vitest";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { DynamoDbChecklistRepository } from "./dynamodb-checklist-repository.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";

/** Tests actual SDK conditions/atomicity, not a live DynamoDB emulator. */
export function checklistDynamoFixture() {
  const base = tripDynamoFixture();
  const faults: { beforeTransaction?: () => void; lostResponse?: boolean } = {};
  const client: TripDynamoClient = { async send(command) {
    if (!(command instanceof TransactWriteItemsCommand)) return base.client.send(command);
    base.commands.push(command);
    faults.beforeTransaction?.(); faults.beforeTransaction = undefined;
    const puts = command.input.TransactItems!.map((w) => w.Put!);
    for (const p of puts) {
      const item = p.Item!, key = `${item.pk!.S}/${item.sk!.S}`, old = base.records.get(key);
      expect(p.TableName).toBe("test-trips");
      const field = item.sk!.S!.startsWith("CHECKLIST_STATE#") ? "version" : "revision";
      expect(p.ConditionExpression).toBe(p.ExpressionAttributeValues ? `attribute_exists(pk) AND ${field === "version" ? "#version" : field} = :base` : "attribute_not_exists(pk)");
      if (p.ExpressionAttributeValues ? !old || old[field]?.N !== p.ExpressionAttributeValues[":base"]!.N : !!old) {
        throw Object.assign(new Error("private database detail"), { CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
      }
    }
    for (const p of puts) base.records.set(`${p.Item!.pk!.S}/${p.Item!.sk!.S}`, structuredClone(p.Item!));
    if (faults.lostResponse) { faults.lostResponse = false; throw new Error("response lost"); }
    return {};
  } };
  return { ...base, client, checklist: new DynamoDbChecklistRepository("test-trips", client), checklistFaults: faults };
}
