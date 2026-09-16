import { expect } from "vitest";
import { GetItemCommand, PutItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";
import { DynamoDbTripRecheckRepository } from "./dynamodb-trip-recheck.js";

/** Synthetic internal queue, with real SDK conditions/CAS evaluated (not a live AWS test). */
export function recheckDynamoFixture() {
  const rows = new Map<string, Record<string, AttributeValue>>(), commands: unknown[] = [];
  const faults: { lostResponse?: boolean; fail?: boolean; hints?: Record<string, AttributeValue>[] } = {};
  const client: TripDynamoClient = { async send(command) {
    commands.push(command);
    if (faults.fail) throw new Error("private database failure");
    if (command instanceof QueryCommand) {
      expect(command.input.IndexName).toBe("recheck-due");
      expect(command.input.KeyConditionExpression).toBe("recheckShard = :shard AND dueAt <= :now");
      expect(command.input.Limit).toBe(5);
      const v = command.input.ExpressionAttributeValues!;
      return { Items: structuredClone((faults.hints ?? [...rows.values()].filter((r) => r.recheckShard?.S === v[":shard"]!.S &&
        Number(r.dueAt?.N) <= Number(v[":now"]!.N))).sort((a, b) => Number(a.dueAt?.N) - Number(b.dueAt?.N)).slice(0, 5).map(({ pk, sk }) => ({ pk, sk }))) };
    }
    if (command instanceof GetItemCommand) {
      expect(command.input.ConsistentRead).toBe(true);
      const key = command.input.Key!; return { Item: structuredClone(rows.get(`${key.pk!.S}/${key.sk!.S}`)) };
    }
    if (!(command instanceof PutItemCommand)) throw new Error("unsupported-command");
    const input = command.input, row = input.Item!, key = `${row.pk!.S}/${row.sk!.S}`, old = rows.get(key), v = input.ExpressionAttributeValues;
    let valid = false;
    switch (input.ConditionExpression) {
      case "attribute_not_exists(pk)": valid = !old; break;
      case "deliveryVersion = :base": valid = !!old && JSON.stringify(old.deliveryVersion) === JSON.stringify(v![":base"]); break;
      case "attribute_exists(pk) AND attribute_not_exists(deliveryVersion)": valid = !!old && !old.deliveryVersion; break;
      case "deliveryVersion = :base AND deliveryState = :pending":
        valid = !!old && JSON.stringify(old.deliveryVersion) === JSON.stringify(v![":base"]) && old.deliveryState?.S === "pending"; break;
      case "deliveryVersion = :base AND deliveryState = :dead":
        valid = !!old && JSON.stringify(old.deliveryVersion) === JSON.stringify(v![":base"]) && old.deliveryState?.S === "dead"; break;
      default: throw new Error("unsupported-condition");
    }
    if (!valid) throw Object.assign(new Error("conditional-private-detail"), { name: "ConditionalCheckFailedException" });
    rows.set(key, structuredClone(row));
    if (faults.lostResponse) { faults.lostResponse = false; throw new Error("lost-response-private-detail"); }
    return {};
  } };
  return { rows, commands, faults, repository: new DynamoDbTripRecheckRepository("test-rechecks", client) };
}
