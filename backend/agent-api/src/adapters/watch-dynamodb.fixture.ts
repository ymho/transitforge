import { expect } from "vitest";
import { QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { DynamoDbTripWatchRepository } from "./dynamodb-trip-watch-repository.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";

/** Executable SDK condition contract fake, not a live DynamoDB emulator. */
export function watchDynamoFixture() {
  const base = tripDynamoFixture();
  const faults: { beforeTransaction?: () => void; lostResponse?: boolean; failBatch?: number;
    indexed?: Record<string, AttributeValue>[] } = {};
  let transactions = 0;
  const client: TripDynamoClient = { async send(command) {
    if (command instanceof QueryCommand && command.input.IndexName) {
      base.commands.push(command);
      expect(command.input.IndexName).toBe("watch-subject");
      expect(command.input.KeyConditionExpression).toBe("watchSubject = :subject");
      expect(command.input.ConsistentRead).toBeUndefined();
      const subject = command.input.ExpressionAttributeValues![":subject"]!.S;
      const rows = faults.indexed ?? [...base.records.values()].filter((r) => r.watchSubject?.S === subject);
      return { Items: structuredClone(rows) };
    }
    if (!(command instanceof TransactWriteItemsCommand) || !command.input.TransactItems?.[0]?.ConditionCheck) return base.client.send(command);
    base.commands.push(command); transactions += 1;
    faults.beforeTransaction?.(); faults.beforeTransaction = undefined;
    if (faults.failBatch === transactions) throw new Error("temporary database error");
    const [guard, state, ...rows] = command.input.TransactItems;
    expect(command.input.TransactItems.length).toBeLessThanOrEqual(100);
    const check = guard!.ConditionCheck!, key = check.Key!, oldTrip = base.records.get(`${key.pk!.S}/${key.sk!.S}`), values = check.ExpressionAttributeValues!;
    const active = check.ConditionExpression === "attribute_exists(pk) AND archived = :active AND trip = :trip";
    if (!active) expect(check.ConditionExpression).toBe("attribute_not_exists(pk) OR archived = :archived");
    const tripOK = active ? !!oldTrip && oldTrip.archived?.BOOL === false && oldTrip.trip?.S === values[":trip"]?.S : !oldTrip || oldTrip.archived?.BOOL === true;
    const put = state!.Put!, item = put.Item!, oldState = base.records.get(`${item.pk!.S}/${item.sk!.S}`);
    expect(put.ConditionExpression).toBe(put.ExpressionAttributeValues ? "#version = :base" : "attribute_not_exists(pk)");
    const stateOK = put.ExpressionAttributeValues ? oldState?.version?.N === put.ExpressionAttributeValues[":base"]?.N : !oldState;
    if (!tripOK || !stateOK) throw Object.assign(new Error("private conditional detail"), { CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
    // All conditions checked before writes; never mutate Trip/Reservation/Checklist.
    for (const entry of [state!, ...rows]) {
      const row = entry.Put!.Item!;
      expect(row.sk!.S).toMatch(/^WATCH(?:#|_STATE#)/);
      base.records.set(`${row.pk!.S}/${row.sk!.S}`, structuredClone(row));
    }
    if (faults.lostResponse) { faults.lostResponse = false; throw new Error("lost response"); }
    return {};
  } };
  return { ...base, client, watches: new DynamoDbTripWatchRepository("test-trips", client), watchFaults: faults };
}
