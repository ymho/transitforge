import { expect } from "vitest";
import { GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { DynamoDbTripRepository, type TripDynamoClient } from "./dynamodb-trip-repository.js";
import type { Trip } from "@raiquora/trip/trip";

/** SDK expression/transaction contract fake; this is not a live DynamoDB test. */
export function tripDynamoFixture() {
  const records = new Map<string, Record<string, AttributeValue>>(), commands: unknown[] = [];
  const key = (item: Record<string, AttributeValue>) => `${item.pk!.S}/${item.sk!.S}`;
  const conditional = () => { throw Object.assign(new Error("sensitive SDK detail"), { name: "ConditionalCheckFailedException" }); };
  const faults: { beforeTransaction?: () => void; lostResponse?: boolean } = {};
  const client: TripDynamoClient = { async send(command) {
    commands.push(command);
    if (command instanceof TransactWriteItemsCommand) {
      faults.beforeTransaction?.(); faults.beforeTransaction = undefined;
      const [update, put] = command.input.TransactItems!;
      const u = update!.Update!, p = put!.Put!, r = records.get(key(u.Key!)), v = u.ExpressionAttributeValues!;
      expect(u.ConditionExpression).toBe("attribute_exists(pk) AND archived = :active AND (revision = :base OR (attribute_not_exists(revision) AND trip = :old))");
      expect(u.UpdateExpression).toBe("SET trip = :trip, revision = :next");
      expect(p.ConditionExpression).toBe("attribute_not_exists(pk)");
      const valid = !!r && r.archived?.BOOL === false && (r.revision?.N === v[":base"]!.N || !r.revision && r.trip?.S === v[":old"]!.S);
      if (!valid || records.has(key(p.Item!))) throw Object.assign(new Error("cancelled-private-data"), { name: "TransactionCanceledException",
        CancellationReasons: [{ Code: valid ? "None" : "ConditionalCheckFailed" }, { Code: records.has(key(p.Item!)) ? "ConditionalCheckFailed" : "None" }] });
      r.trip = structuredClone(v[":trip"]!); r.revision = structuredClone(v[":next"]!);
      records.set(key(p.Item!), structuredClone(p.Item!));
      if (faults.lostResponse) { faults.lostResponse = false; throw new Error("response lost"); }
      return {};
    }
    if (command instanceof QueryCommand) {
      const i = command.input;
      expect(i.KeyConditionExpression).toBe("pk = :owner AND begins_with(sk, :prefix)");
      const pk = i.ExpressionAttributeValues![":owner"]!.S, after = i.ExclusiveStartKey?.sk?.S;
      const prefix = i.ExpressionAttributeValues![":prefix"]!.S!;
      const items = [...records.values()].filter((r) => r.pk?.S === pk && r.sk?.S?.startsWith(prefix) && (!after || r.sk.S > after)).sort((a, b) => a.sk!.S!.localeCompare(b.sk!.S!));
      const page = items.slice(0, i.Limit);
      return { Items: structuredClone(page), ...(items.length > page.length ? { LastEvaluatedKey: { pk: page.at(-1)!.pk!, sk: page.at(-1)!.sk! } } : {}) };
    }
    if (command instanceof PutItemCommand) {
      const i = command.input, k = key(i.Item!);
      if (i.ConditionExpression === "attribute_not_exists(pk)" && records.has(k)) conditional();
      if (i.ConditionExpression === "attribute_exists(pk) AND revision = :base" &&
        (!records.has(k) || records.get(k)!.revision?.N !== i.ExpressionAttributeValues![":base"]!.N)) conditional();
      records.set(k, structuredClone(i.Item!)); return {};
    }
    const i = command.input, k = key(i.Key!);
    if (command instanceof GetItemCommand) return records.has(k) ? { Item: structuredClone(records.get(k)!) } : {};
    if (command instanceof DeleteItemCommand) { expect(i.Key!.sk!.S).toMatch(/^CONVERSATION#/); records.delete(k); return {}; }
    if (command instanceof UpdateItemCommand) {
      const r = records.get(k);
      expect(command.input.ConditionExpression).toBe("attribute_exists(pk) AND archived = :active");
      if (!r || r.archived?.BOOL !== false) conditional();
      r!.archived = command.input.ExpressionAttributeValues![":archived"]!; return {};
    }
    throw new Error("Unexpected command");
  } };
  const clock = { now: () => new Date("2026-09-14T02:00:00.000Z") };
  const repository = new DynamoDbTripRepository("test-trips", client, clock);
  return { repository, records, commands, faults, client, clock,
    seed(trip: Trip, owner = "owner-A", oldEnvelope = false) {
      const item = { pk: { S: `OWNER#${owner}` }, sk: { S: `TRIP#${trip.id}` }, storageVersion: { N: "1" }, archived: { BOOL: false }, trip: { S: JSON.stringify(trip) },
        ...(oldEnvelope ? {} : { revision: { N: String(trip.revision) } }) };
      records.set(key(item), item);
    } };
}
