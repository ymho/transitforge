import { expect } from "vitest";
import { GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";
import { DynamoDbNotificationRepository, DynamoDbInAppDelivery } from "./dynamodb-notification-repository.js";
import { DynamoDbTripImpactRepository } from "./dynamodb-trip-impact-repository.js";

/** Expression-contract fake: transactions validate every condition before committing any write. */
export function notificationDynamoFixture() {
  const base = tripDynamoFixture(), rows = new Map<string, Record<string, AttributeValue>>();
  const faults: { beforeTransaction?: () => void; lostResponse?: boolean; fail?: boolean } = {};
  const key = (r: Record<string, AttributeValue>) => `${r.pk!.S}/${r.sk!.S}`;
  const store = (table?: string) => table === "notifications" ? rows : base.records;
  const reject = () => { throw Object.assign(new Error("private conditional failure"), { name: "ConditionalCheckFailedException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }] }); };
  function valid(table: string | undefined, Key: Record<string, AttributeValue>, condition: string | undefined, v: Record<string, AttributeValue> = {}) {
    const old = store(table).get(key(Key));
    switch (condition) {
      case "attribute_not_exists(pk)": return !old;
      case "attribute_exists(pk) AND attribute_not_exists(workVersion)": return !!old && !old.workVersion;
      case "workVersion = :base": return old?.workVersion?.N === v[":base"]?.N;
      case "workVersion = :base AND workState = :pending": return old?.workVersion?.N === v[":base"]?.N && old?.workState?.S === "pending";
      case "workVersion = :base AND workState = :dead": return old?.workVersion?.N === v[":base"]?.N && old?.workState?.S === "dead";
      case "resourceVersion = :version": return old?.resourceVersion?.N === v[":version"]?.N;
      case "attribute_exists(pk) AND archived = :active AND trip = :trip": return !!old && old.archived?.BOOL === false && old.trip?.S === v[":trip"]?.S;
      case "attribute_exists(pk) AND archived = :active AND revision = :revision": return !!old && old.archived?.BOOL === false && old.revision?.N === v[":revision"]?.N;
      case "attribute_not_exists(pk) OR impactId = :id": return !old || old.impactId?.S === v[":id"]?.S;
      case "attribute_not_exists(pk) OR dedupeKey = :dedupe": return !old || old.dedupeKey?.S === v[":dedupe"]?.S;
      case "observation = :observation": return old?.observation?.S === v[":observation"]?.S;
      case "attribute_not_exists(pk) OR sourceTripRevision < :revision OR (sourceTripRevision = :revision AND observationOrder <= :order)":
        return !old || Number(old.sourceTripRevision?.N) < Number(v[":revision"]?.N) || old.sourceTripRevision?.N === v[":revision"]?.N && old.observationOrder!.S! <= v[":order"]!.S!;
      default: throw new Error(`Unexpected condition ${condition}`);
    }
  }
  function update(table: string | undefined, Key: Record<string, AttributeValue>, expression: string, v: Record<string, AttributeValue>) {
    const previous = store(table).get(key(Key));
    const row = expression.startsWith("SET storageVersion = :one, workKind") ? { ...Key, storageVersion: v[":one"]!, workKind: v[":kind"]!, observation: v[":observation"]!,
      sourceTripRevision: v[":revision"]!, observationOrder: v[":order"]!, workVersion: { N: String(Number(previous?.workVersion?.N ?? 0) + 1) },
      attempts: v[":zero"]!, workState: v[":pending"]!, workShard: v[":shard"]!, availableAt: v[":now"]! } : { ...Key, storageVersion: v[":one"]!, dedupeKey: v[":dedupe"]!, notificationId: v[":id"]! };
    store(table).set(key(Key), structuredClone(row));
  }
  const client: TripDynamoClient = { async send(command) {
    if (!(command instanceof TransactWriteItemsCommand) && command.input.TableName !== "notifications") return base.client.send(command);
    base.commands.push(command);
    if (command instanceof GetItemCommand) return { Item: structuredClone(rows.get(key(command.input.Key!))) };
    if (command instanceof QueryCommand) {
      const i = command.input, v = i.ExpressionAttributeValues!, after = i.ExclusiveStartKey?.sk?.S;
      if (i.IndexName) { expect(i.IndexName).toBe("notification-due"); expect(i.Limit).toBe(5); }
      const result = [...rows.values()].filter((r) => i.IndexName ? r.workShard?.S === v[":shard"]?.S && Number(r.availableAt?.N) <= Number(v[":now"]?.N) : r.pk?.S === v[":owner"]?.S && r.sk?.S?.startsWith(v[":prefix"]!.S!) && (!after || r.sk.S > after)).sort((a, b) => a.sk!.S!.localeCompare(b.sk!.S!));
      const page = result.slice(0, i.Limit); return { Items: structuredClone(page), ...(result.length > page.length ? { LastEvaluatedKey: { pk: page.at(-1)!.pk!, sk: page.at(-1)!.sk! } } : {}) };
    }
    if (command instanceof PutItemCommand) {
      const i = command.input; if (!valid(i.TableName, i.Item!, i.ConditionExpression, i.ExpressionAttributeValues)) reject(); rows.set(key(i.Item!), structuredClone(i.Item!)); return {};
    }
    if (command instanceof UpdateItemCommand) {
      const i = command.input; if (!valid(i.TableName, i.Key!, i.ConditionExpression, i.ExpressionAttributeValues)) reject(); update(i.TableName, i.Key!, i.UpdateExpression!, i.ExpressionAttributeValues!); return {};
    }
    if (command instanceof TransactWriteItemsCommand) {
      faults.beforeTransaction?.(); faults.beforeTransaction = undefined;
      if (faults.fail) throw new Error("private backend detail");
      for (const a of command.input.TransactItems!) {
        const op = a.Put ?? a.Update ?? a.ConditionCheck!;
        if (!valid(op.TableName, a.Put?.Item ?? a.Update?.Key ?? a.ConditionCheck!.Key!, op.ConditionExpression, op.ExpressionAttributeValues)) reject();
      }
      for (const a of command.input.TransactItems!) {
        if (a.Put) store(a.Put.TableName).set(key(a.Put.Item!), structuredClone(a.Put.Item!));
        if (a.Update) update(a.Update.TableName, a.Update.Key!, a.Update.UpdateExpression!, a.Update.ExpressionAttributeValues!);
      }
      if (faults.lostResponse) { faults.lostResponse = false; throw new Error("response lost"); } return {};
    }
    throw new Error("Unexpected SDK command");
  } };
  let now = Date.parse("2026-09-13T00:00:00Z");
  return { ...base, client, rows, faults, clock: { now: () => new Date(now) }, setNow(value: string | number) { now = typeof value === "string" ? Date.parse(value) : value; },
    notifications: new DynamoDbNotificationRepository("notifications", "test-trips", client),
    impacts: new DynamoDbTripImpactRepository("test-trips", client, "notifications"),
    channel: new DynamoDbInAppDelivery("notifications", "test-trips", client, () => now) };
}
