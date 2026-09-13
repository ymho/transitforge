import { DynamoDBClient, GetItemCommand, QueryCommand, PutItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { TripResourceError } from "../contracts/trip-api.js";
import { validateTripChanged, type TripChanged } from "../contracts/trip-changed.js";
import { requireTripPrincipal } from "../ports/trip-repository.js";
import { tripChangedBackoff, tripChangedDelivery, type OutboxKey, type OutboxClaim, type TripChangedOutbox } from "../ports/trip-changed-outbox.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";
import { outboxShard } from "./trip-changed-record.js";

type Row = Record<string, AttributeValue>;
const nonnegative = (v: AttributeValue | undefined) => v?.N !== undefined && /^(0|[1-9][0-9]*)$/.test(v.N) && Number.isSafeInteger(Number(v.N));
function keyAttributes(key: OutboxKey): Row {
  if (!key.pk.startsWith("OWNER#") || !/^TRIP_CHANGED#[0-9a-f]{64}$/.test(key.sk)) throw new TripResourceError("invalid-input");
  requireTripPrincipal({ subject: key.pk.slice(6) });
  return { pk: { S: key.pk }, sk: { S: key.sk } };
}
/** Dedicated internal delivery index, NOT a cross-owner Watch/event fanout index. */
export class DynamoDbTripChangedOutbox implements TripChangedOutbox {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({})) {}
  async due(now: number): Promise<OutboxKey[]> {
    const result: OutboxKey[] = [];
    // Small fixed shards, one bounded page each. Pending records never expire; next tick drains backlog.
    for (let shard = 0; shard < tripChangedDelivery.shards; shard++) {
      const page = await this.client.send(new QueryCommand({ TableName: this.table, IndexName: "trip-changed-due",
        KeyConditionExpression: "outboxShard = :shard AND availableAt <= :now",
        ExpressionAttributeValues: { ":shard": { S: `pending#${shard}` }, ":now": { N: String(now) } }, Limit: tripChangedDelivery.pageSize }));
      for (const row of page.Items ?? []) {
        const key = { pk: row.pk?.S ?? "", sk: row.sk?.S ?? "" };
        keyAttributes(key); result.push(key);
      }
    }
    return result;
  }
  async claim(key: OutboxKey, now: number): Promise<OutboxClaim | undefined> {
    const Key = keyAttributes(key);
    const { Item: row } = await this.client.send(new GetItemCommand({ TableName: this.table, Key, ConsistentRead: true }));
    if (!row || row.deliveryState?.S === "done" || row.deliveryState?.S === "dead") return undefined;
    if (row.pk?.S !== key.pk || row.sk?.S !== key.sk) throw new TripResourceError("unavailable");
    const validMetadata = row.storageVersion?.N === "1" && row.deliveryState?.S === "pending" &&
      nonnegative(row.deliveryVersion) && Number(row.deliveryVersion!.N) < Number.MAX_SAFE_INTEGER &&
      nonnegative(row.attempts) && nonnegative(row.availableAt) && row.outboxShard?.S === outboxShard(key.sk.slice(13));
    if (validMetadata && Number(row.availableAt!.N) > now) return undefined;
    let event: TripChanged | undefined;
    try {
      if (!validMetadata || !row.event?.S || row.event.S.length > 2048) throw new Error();
      const parsed = JSON.parse(row.event.S); validateTripChanged(parsed);
      if (`OWNER#${parsed.ownerSubject}` !== key.pk || `TRIP_CHANGED#${parsed.eventId}` !== key.sk) throw new Error();
      event = parsed;
    } catch { /* Poison is claimed and quarantined using the trusted key, never its asserted owner. */ }
    const version = validMetadata ? Number(row.deliveryVersion!.N) + 1 : 1;
    const attempt = validMetadata ? Number(row.attempts!.N) + 1 : tripChangedDelivery.maxAttempts + 1;
    const claim = { key, version, attempt, event };
    try {
      await this.client.send(new PutItemCommand({ TableName: this.table,
        Item: this.row(claim, "pending", now + tripChangedDelivery.leaseMs),
        ConditionExpression: row.deliveryVersion ? "deliveryVersion = :base" : "attribute_exists(pk) AND attribute_not_exists(deliveryVersion)",
        ...(row.deliveryVersion ? { ExpressionAttributeValues: { ":base": row.deliveryVersion } } : {}),
      }));
      return claim;
    } catch (error) { if ((error as Error)?.name === "ConditionalCheckFailedException") return undefined; throw error; }
  }
  async finish(claim: OutboxClaim, state: "done" | "pending" | "dead", now: number): Promise<void> {
    await this.client.send(new PutItemCommand({ TableName: this.table,
      Item: this.row(claim, state, state === "pending" ? now + tripChangedBackoff(claim.attempt) : now),
      ConditionExpression: "deliveryVersion = :base AND deliveryState = :pending",
      ExpressionAttributeValues: { ":base": { N: String(claim.version) }, ":pending": { S: "pending" } },
    }));
  }
  /** Operator-only replay seam, not wired to HTTP or scheduled automatic retries. */
  async redrive(key: OutboxKey, expectedVersion: number, now: number): Promise<void> {
    const Key = keyAttributes(key);
    const { Item: row } = await this.client.send(new GetItemCommand({ TableName: this.table, Key, ConsistentRead: true }));
    if (!row || row.pk?.S !== key.pk || row.sk?.S !== key.sk || row.deliveryState?.S !== "dead" ||
        row.deliveryVersion?.N !== String(expectedVersion) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 ||
        expectedVersion >= Number.MAX_SAFE_INTEGER || !row.event?.S || row.event.S.length > 2048) throw new TripResourceError("conflict");
    let event: TripChanged;
    try {
      event = JSON.parse(row.event.S); validateTripChanged(event);
      if (`OWNER#${event.ownerSubject}` !== key.pk || `TRIP_CHANGED#${event.eventId}` !== key.sk) throw new Error();
    } catch { throw new TripResourceError("invalid-input"); }
    await this.client.send(new PutItemCommand({ TableName: this.table,
      Item: this.row({ key, event, version: expectedVersion + 1, attempt: 0 }, "pending", now),
      ConditionExpression: "deliveryVersion = :base AND deliveryState = :dead",
      ExpressionAttributeValues: { ":base": { N: String(expectedVersion) }, ":dead": { S: "dead" } },
    }));
  }
  private row(claim: OutboxClaim, state: string, availableAt: number): Row {
    return { ...keyAttributes(claim.key), storageVersion: { N: "1" }, deliveryVersion: { N: String(claim.version) },
      attempts: { N: String(claim.attempt) }, deliveryState: { S: state },
      // Invalid event is deliberately not copied into the dead-letter resource.
      ...(claim.event ? { event: { S: JSON.stringify(claim.event) } } : {}),
      ...(state !== "done" ? { outboxShard: { S: outboxShard(claim.key.sk.slice(13), state) }, availableAt: { N: String(availableAt) } } : {}),
    };
  }
}
