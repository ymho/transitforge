import { createHash } from "node:crypto";
import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { validateRecheckTask, type TripRecheckTask } from "../contracts/trip-recheck.js";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";
import { recheckDelivery, type RecheckClaim, type RecheckCompletion, type RecheckKey, type TripRecheckRepository } from "../ports/trip-recheck.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";

type Row = Record<string, AttributeValue>;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const number = (value?: AttributeValue): number => value?.N !== undefined && /^(0|[1-9][0-9]*)$/.test(value.N) && Number.isSafeInteger(Number(value.N)) ? Number(value.N) : NaN;
function attributes(key: RecheckKey): Row {
  if (!key.pk.startsWith("OWNER#") || !/^RECHECK#[0-9a-f]{64}$/.test(key.sk)) throw new Error("invalid-recheck-key");
  requireTripPrincipal({ subject: key.pk.slice(6) });
  return { pk: { S: key.pk }, sk: { S: key.sk } };
}
const shard = (key: RecheckKey, state = "pending") => `${state}#${parseInt(key.sk.slice(8, 10), 16) % recheckDelivery.shards}`;
const conditional = (error: unknown) => (error as Error)?.name === "ConditionalCheckFailedException";

/** Internal queue in a separate table: Agent/Trip writers have no grants to it. No Scan/TTL/Delete. */
export class DynamoDbTripRecheckRepository implements TripRecheckRepository {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({})) {}
  async ensure(principal: TripPrincipal, task: TripRecheckTask): Promise<void> {
    requireTripPrincipal(principal); validateRecheckTask(task);
    const key = { pk: `OWNER#${principal.subject}`, sk: `RECHECK#${digest(task.id)}` };
    try {
      await this.client.send(new PutItemCommand({ TableName: this.table, ConditionExpression: "attribute_not_exists(pk)",
        Item: this.row({ key, task, version: 0, attempt: 0, replay: 0, cycleStartedAt: 0, dueAt: task.dueAt },
          { state: "pending", dueAt: task.dueAt, attempt: 0, replay: 0, cycleStartedAt: 0 }) }));
    } catch (error) { if (!conditional(error)) throw error; } // Never reset a claimed/completed/dead task on duplicate reconcile.
  }
  async due(now: number): Promise<RecheckKey[]> {
    const keys: RecheckKey[] = [];
    for (let i = 0; i < recheckDelivery.shards; i++) {
      const page = await this.client.send(new QueryCommand({ TableName: this.table, IndexName: "recheck-due",
        KeyConditionExpression: "recheckShard = :shard AND dueAt <= :now",
        ExpressionAttributeValues: { ":shard": { S: `pending#${i}` }, ":now": { N: String(now) } }, Limit: recheckDelivery.pageSize }));
      for (const row of page.Items ?? []) {
        const key = { pk: row.pk?.S ?? "", sk: row.sk?.S ?? "" }; attributes(key); keys.push(key);
      }
    }
    return keys;
  }
  async claim(key: RecheckKey, now: number): Promise<RecheckClaim | undefined> {
    const { Item: row } = await this.client.send(new GetItemCommand({ TableName: this.table, Key: attributes(key), ConsistentRead: true }));
    if (!row || ["dead", "inactive"].includes(row.deliveryState?.S ?? "")) return undefined;
    if (row.pk?.S !== key.pk || row.sk?.S !== key.sk) throw new Error("invalid-recheck-storage-key");
    const valid = row.storageVersion?.N === "1" && row.deliveryState?.S === "pending" && row.recheckShard?.S === shard(key) &&
      [row.deliveryVersion, row.attempts, row.replay, row.cycleStartedAt, row.dueAt].every((v) => Number.isSafeInteger(number(v))) &&
      number(row.deliveryVersion) < Number.MAX_SAFE_INTEGER && number(row.replay) < recheckDelivery.replayPasses;
    if (valid && number(row.dueAt) > now) return undefined;
    let task: TripRecheckTask | undefined;
    try {
      if (!valid || !row.task?.S || row.task.S.length > 10_000) throw new Error();
      task = JSON.parse(row.task.S); validateRecheckTask(task!);
      if (`RECHECK#${digest(task!.id)}` !== key.sk) throw new Error();
    } catch { task = undefined; }
    const claim: RecheckClaim = { key, task, version: valid ? number(row.deliveryVersion) + 1 : 1,
      attempt: valid ? number(row.attempts) + 1 : recheckDelivery.maxAttempts + 1,
      replay: valid ? number(row.replay) : 0, cycleStartedAt: valid && number(row.cycleStartedAt) ? number(row.cycleStartedAt) : now, dueAt: valid ? number(row.dueAt) : now };
    try {
      await this.client.send(new PutItemCommand({ TableName: this.table, Item: this.row(claim,
        { state: "pending", dueAt: now + recheckDelivery.leaseMs, attempt: claim.attempt, replay: claim.replay, cycleStartedAt: claim.cycleStartedAt }),
        ConditionExpression: row.deliveryVersion ? "deliveryVersion = :base" : "attribute_exists(pk) AND attribute_not_exists(deliveryVersion)",
        ...(row.deliveryVersion ? { ExpressionAttributeValues: { ":base": row.deliveryVersion } } : {}) }));
      return claim;
    } catch (error) { if (conditional(error)) return undefined; throw error; }
  }
  async finish(claim: RecheckClaim, completion: RecheckCompletion): Promise<void> {
    await this.client.send(new PutItemCommand({ TableName: this.table, Item: this.row(claim, completion),
      ConditionExpression: "deliveryVersion = :base AND deliveryState = :pending",
      ExpressionAttributeValues: { ":base": { N: String(claim.version) }, ":pending": { S: "pending" } } }));
  }
  /** Explicit operator-only CAS redrive. Not reachable from tick, HTTP or Agent. */
  async redrive(key: RecheckKey, version: number, now: number): Promise<void> {
    const { Item: row } = await this.client.send(new GetItemCommand({ TableName: this.table, Key: attributes(key), ConsistentRead: true }));
    if (!row || row.pk?.S !== key.pk || row.sk?.S !== key.sk || row.deliveryState?.S !== "dead" || number(row.deliveryVersion) !== version || !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER || !row.task?.S || !Number.isSafeInteger(now) || now < 0) throw new Error("redrive-conflict");
    const task: TripRecheckTask = JSON.parse(row.task.S); validateRecheckTask(task);
    if (key.sk !== `RECHECK#${digest(task.id)}`) throw new Error("redrive-invalid");
    await this.client.send(new PutItemCommand({ TableName: this.table,
      Item: this.row({ key, task, version: version + 1, attempt: 0, replay: 0, cycleStartedAt: 0, dueAt: now },
        { state: "pending", dueAt: now, attempt: 0, replay: 0, cycleStartedAt: 0 }),
      ConditionExpression: "deliveryVersion = :base AND deliveryState = :dead",
      ExpressionAttributeValues: { ":base": { N: String(version) }, ":dead": { S: "dead" } } }));
  }
  private row(claim: RecheckClaim, completion: RecheckCompletion): Row {
    const pending = completion.state === "pending";
    return { ...attributes(claim.key), storageVersion: { N: "1" }, deliveryState: { S: completion.state },
      deliveryVersion: { N: String(claim.version) }, attempts: { N: String(pending ? completion.attempt : claim.attempt) },
      replay: { N: String(pending ? completion.replay : claim.replay) }, cycleStartedAt: { N: String(pending ? completion.cycleStartedAt : claim.cycleStartedAt) },
      ...(claim.task ? { task: { S: JSON.stringify(claim.task) } } : {}),
      ...(completion.state !== "inactive" ? { recheckShard: { S: shard(claim.key, completion.state) }, dueAt: { N: String(pending ? completion.dueAt : claim.cycleStartedAt) } } : {}) };
  }
}
