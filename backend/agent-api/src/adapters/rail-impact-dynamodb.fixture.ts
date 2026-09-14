import { expect } from "vitest";
import { QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { watchDynamoFixture } from "./watch-dynamodb.fixture.js";
import { DynamoDbRailImpactRouter } from "./dynamodb-rail-impact-router.js";
import { DynamoDbTripImpactRepository } from "./dynamodb-trip-impact-repository.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";

/** Extends existing transaction fake; checks real SDK expressions and base-table isolation. */
export function railImpactDynamoFixture() {
  const base = watchDynamoFixture();
  const impactFaults: { routingRows?: Record<string, AttributeValue>[]; beforeSave?: () => void; lostResponse?: boolean; fail?: boolean } = {};
  const client: TripDynamoClient = { async send(command) {
    if (command instanceof QueryCommand && command.input.IndexName === "rail-watch-routing") {
      base.commands.push(command);
      expect(command.input.KeyConditionExpression).toBe("railSubject = :subject");
      expect(command.input.ConsistentRead).toBeUndefined();
      const subject = command.input.ExpressionAttributeValues![":subject"]!.S;
      const rows = impactFaults.routingRows ?? [...base.records.values()].filter((r) => r.railSubject?.S === subject).map((r) => ({ pk: r.pk!, sk: r.sk!, railSubject: r.railSubject! }));
      const cursor = command.input.ExclusiveStartKey;
      const start = cursor ? rows.findIndex((r) => r.pk?.S === cursor.pk?.S && r.sk?.S === cursor.sk?.S) + 1 : 0;
      const page = rows.slice(start, start + command.input.Limit!);
      return { Items: structuredClone(page), ...(start + page.length < rows.length ? { LastEvaluatedKey: structuredClone(page.at(-1)) } : {}) };
    }
    if (!(command instanceof TransactWriteItemsCommand) || !command.input.TransactItems?.[1]?.Put?.Item?.sk?.S?.startsWith("IMPACT#")) return base.client.send(command);
    base.commands.push(command); impactFaults.beforeSave?.(); impactFaults.beforeSave = undefined;
    if (impactFaults.fail) throw new Error("private backend failure");
    const [guard, write] = command.input.TransactItems;
    expect(command.input.TransactItems).toHaveLength(2);
    const check = guard!.ConditionCheck!, put = write!.Put!, item = put.Item!;
    expect(check.ConditionExpression).toBe("attribute_exists(pk) AND archived = :active AND trip = :trip");
    expect(put.ConditionExpression).toBe("attribute_not_exists(pk) OR impactId = :id");
    const trip = base.records.get(`${check.Key!.pk!.S}/${check.Key!.sk!.S}`), key = `${item.pk!.S}/${item.sk!.S}`, previous = base.records.get(key);
    if (!trip || trip.archived?.BOOL !== false || trip.trip?.S !== check.ExpressionAttributeValues![":trip"]!.S ||
        previous && previous.impactId?.S !== put.ExpressionAttributeValues![":id"]!.S)
      throw Object.assign(new Error("private conditional failure"), { CancellationReasons: [{ Code: "ConditionalCheckFailed" }] });
    expect(Object.keys(item).sort()).toEqual(["pk", "sk", "storageVersion", "impact", "impactId"].sort());
    base.records.set(key, structuredClone(item));
    if (impactFaults.lostResponse) { impactFaults.lostResponse = false; throw new Error("lost response"); }
    return {};
  } };
  return { ...base, client, impactFaults, router: new DynamoDbRailImpactRouter("test-trips", client), impacts: new DynamoDbTripImpactRepository("test-trips", client) };
}
