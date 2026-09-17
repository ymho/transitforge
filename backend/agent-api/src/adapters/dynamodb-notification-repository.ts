import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand,
  type AttributeValue, type TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { validateNotification, validateNotificationEpisode, validateNotificationObservation, type TripNotification,
  type NotificationEpisode, type ImpactNotificationObservation } from "@raiquora/trip/notification";
import type { Trip } from "@raiquora/trip/trip";
import type { NotificationDecision } from "@raiquora/trip/notification-policy";
import { TripResourceError, tripIdentifier, boundedTrip } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";
import { notificationBackoff, notificationDeliveryPolicy, type NotificationRepository, type NotificationWork, type NotificationWorkKey, type NotificationDelivery } from "../ports/notification.js";
import { DynamoDbTripRepository, type TripDynamoClient } from "./dynamodb-trip-repository.js";
import { signalKey, episodeKey, notificationShard } from "./notification-record.js";

type Row = Record<string, AttributeValue>;
const integer = (v?: AttributeValue) => v?.N !== undefined && /^(0|[1-9][0-9]*)$/.test(v.N) && Number.isSafeInteger(Number(v.N)) ? Number(v.N) : NaN;
const opaque = (id: string) => { if (!/^[a-f0-9]{64}$/.test(id)) throw new TripResourceError("invalid-input"); return id; };
const pk = (p: TripPrincipal) => { requireTripPrincipal(p); return `OWNER#${p.subject}`; };
const key = (p: TripPrincipal, sk: string): Row => ({ pk: { S: pk(p) }, sk: { S: sk } });
const workKey = (k: NotificationWorkKey): Row => {
  if (!k.pk.startsWith("OWNER#") || !/^(SIGNAL#[a-f0-9-]{36}#[a-f0-9]{64}|DELIVER#[a-f0-9]{64})$/i.test(k.sk)) throw new TripResourceError("invalid-input");
  return key({ subject: k.pk.slice(6) }, k.sk);
};
const conflict = (e: unknown) => (e as Error)?.name === "ConditionalCheckFailedException" ||
  (e as { CancellationReasons?: { Code?: string }[] })?.CancellationReasons?.some((r) => ["ConditionalCheckFailed", "TransactionConflict"].includes(r.Code ?? ""));

/** Separate notification table. No raw Event, Trip body, private Reservation or channel secrets. */
export class DynamoDbNotificationRepository implements NotificationRepository {
  constructor(private readonly table: string, private readonly tripTable: string, private readonly client: TripDynamoClient = new DynamoDBClient({ maxAttempts: 2, requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 } })) {}
  private async read(Key: Row) {
    const row = (await this.client.send(new GetItemCommand({ TableName: this.table, Key, ConsistentRead: true }))).Item;
    if (row && (row.pk?.S !== Key.pk!.S || row.sk?.S !== Key.sk!.S || row.storageVersion?.N !== "1")) throw new TripResourceError("unavailable");
    return row;
  }
  private parse<T>(row: Row, field: string, validate: (v: T) => void): T {
    const encoded = row[field]?.S;
    if (!encoded || Buffer.byteLength(encoded) > 300000) throw new TripResourceError("unavailable");
    try { const value: T = JSON.parse(encoded); validate(value); return value; } catch { throw new TripResourceError("unavailable"); }
  }
  async observation(p: TripPrincipal, tripId: string, subject: string) {
    tripIdentifier(tripId); const row = await this.read(key(p, signalKey(tripId, subject)));
    if (!row) return undefined;
    const o = this.parse<ImpactNotificationObservation>(row, "observation", validateNotificationObservation);
    if (o.tripId !== tripId || o.subjectKey !== subject) throw new TripResourceError("unavailable"); return o;
  }
  async episode(p: TripPrincipal, tripId: string, revision: number, subject: string) {
    tripIdentifier(tripId); const row = await this.read(key(p, episodeKey(tripId, revision, subject)));
    if (!row) return undefined;
    const e = this.parse<NotificationEpisode>(row, "episode", validateNotificationEpisode);
    if (e.tripId !== tripId || e.tripRevision !== revision || e.subjectKey !== subject || row.resourceVersion?.N !== String(e.version)) throw new TripResourceError("unavailable"); return e;
  }
  async get(p: TripPrincipal, id: string) {
    const row = await this.read(key(p, `NOTIFICATION#${opaque(id)}`)); if (!row) return undefined;
    const n = this.parse<TripNotification>(row, "notification", validateNotification);
    if (n.id !== id || row.resourceVersion?.N !== String(n.version)) throw new TripResourceError("unavailable"); return n;
  }
  async list(p: TripPrincipal, after?: string) {
    const result = await this.client.send(new QueryCommand({ TableName: this.table, ConsistentRead: true,
      KeyConditionExpression: "pk = :owner AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":owner": { S: pk(p) }, ":prefix": { S: "NOTIFICATION#" } },
      Limit: 20, ...(after ? { ExclusiveStartKey: key(p, `NOTIFICATION#${opaque(after)}`) } : {}) }));
    const notifications = (result.Items ?? []).map((r) => {
      const n = this.parse<TripNotification>(r, "notification", validateNotification);
      if (r.pk?.S !== pk(p) || r.sk?.S !== `NOTIFICATION#${n.id}` || r.storageVersion?.N !== "1" || r.resourceVersion?.N !== String(n.version)) throw new TripResourceError("unavailable"); return n;
    });
    const cursor = result.LastEvaluatedKey;
    if (cursor && (cursor.pk?.S !== pk(p) || !cursor.sk?.S?.startsWith("NOTIFICATION#"))) throw new TripResourceError("unavailable");
    return { notifications, ...(cursor ? { after: opaque(cursor.sk!.S!.slice(13)) } : {}) };
  }
  async due(now: number) {
    const result: NotificationWorkKey[] = [];
    for (let shard = 0; shard < notificationDeliveryPolicy.shards; shard++) {
      const page = await this.client.send(new QueryCommand({ TableName: this.table, IndexName: "notification-due",
        KeyConditionExpression: "workShard = :shard AND availableAt <= :now", ExpressionAttributeValues: { ":shard": { S: `pending#${shard}` }, ":now": { N: String(now) } }, Limit: notificationDeliveryPolicy.pageSize }));
      for (const r of page.Items ?? []) { const k = { pk: r.pk?.S ?? "", sk: r.sk?.S ?? "" }; workKey(k); result.push(k); }
    }
    return result;
  }
  async claim(k: NotificationWorkKey, now: number): Promise<NotificationWork | undefined> {
    const Key = workKey(k), row = (await this.client.send(new GetItemCommand({ TableName: this.table, Key, ConsistentRead: true }))).Item;
    if (!row || ["done", "dead"].includes(row.workState?.S ?? "")) return undefined;
    if (row.pk?.S !== k.pk || row.sk?.S !== k.sk) throw new TripResourceError("unavailable");
    const valid = row.storageVersion?.N === "1" && row.workState?.S === "pending" && row.workShard?.S === notificationShard(k.sk) &&
      [row.workVersion, row.attempts, row.availableAt].every((v) => Number.isSafeInteger(integer(v))) && integer(row.workVersion) < Number.MAX_SAFE_INTEGER;
    if (valid && integer(row.availableAt) > now) return undefined;
    const work: NotificationWork = { key: k, version: valid ? integer(row.workVersion) + 1 : 1, attempt: valid ? integer(row.attempts) + 1 : 9 };
    try {
      if (!valid) throw new Error();
      if (row.workKind?.S === "signal") {
        const o = this.parse<ImpactNotificationObservation>(row, "observation", validateNotificationObservation);
        if (k.sk !== signalKey(o.tripId, o.subjectKey)) throw new Error(); work.kind = "signal"; work.observation = o;
      } else if (row.workKind?.S === "delivery" && k.sk === `DELIVER#${opaque(row.notificationId?.S ?? "")}`) {
        work.kind = "delivery"; work.notificationId = row.notificationId!.S;
      } else throw new Error();
    } catch { work.kind = undefined; work.attempt = 9; }
    // Strict allowlist drops malformed payload before poison is dead-lettered.
    const Item = this.workRow(work, "pending", now + notificationDeliveryPolicy.leaseMs);
    try {
      await this.client.send(new PutItemCommand({ TableName: this.table, Item,
        ConditionExpression: row.workVersion ? "workVersion = :base" : "attribute_exists(pk) AND attribute_not_exists(workVersion)",
        ...(row.workVersion ? { ExpressionAttributeValues: { ":base": row.workVersion } } : {}) })); return work;
    } catch (e) { if (conflict(e)) return undefined; throw e; }
  }
  private workRow(w: NotificationWork, state: string, availableAt: number): Row {
    return { ...workKey(w.key), storageVersion: { N: "1" }, workVersion: { N: String(w.version) }, attempts: { N: String(w.attempt) }, workState: { S: state },
      ...(w.kind ? { workKind: { S: w.kind } } : {}), ...(w.observation ? { observation: { S: JSON.stringify(w.observation) }, sourceTripRevision: { N: String(w.observation.tripRevision) },
        observationOrder: { S: `${new Date(w.observation.observedAt).toISOString()}|${new Date(w.observation.evaluatedAt).toISOString()}` } } : {}),
      ...(w.notificationId ? { notificationId: { S: w.notificationId } } : {}),
      ...(state !== "done" ? { workShard: { S: notificationShard(w.key.sk, state) }, availableAt: { N: String(availableAt) } } : {}) };
  }
  private workPut(w: NotificationWork, state: string, now: number): TransactWriteItem {
    return { Put: { TableName: this.table, Item: this.workRow(w, state, now), ConditionExpression: "workVersion = :base AND workState = :pending",
      ExpressionAttributeValues: { ":base": { N: String(w.version) }, ":pending": { S: "pending" } } } };
  }
  private async transaction(items: TransactWriteItem[]) {
    for (const item of items) if (item.Put && Buffer.byteLength(JSON.stringify(item.Put.Item)) > 350000) throw new TripResourceError("payload-too-large");
    try { await this.client.send(new TransactWriteItemsCommand({ TransactItems: items })); }
    catch (e) { throw new TripResourceError(conflict(e) ? "conflict" : "unavailable"); }
  }
  async finish(w: NotificationWork, state: "done" | "pending" | "dead", now: number) {
    await this.transaction([this.workPut(w, state, state === "pending" ? now + notificationBackoff(w.attempt) : now)]);
  }
  async commitDecision(w: NotificationWork, input: Trip, previous: NotificationEpisode | undefined, decision: NotificationDecision, now: number) {
    const trip = boundedTrip(input), p = { subject: w.key.pk.slice(6) }, o = w.observation;
    if (w.kind !== "signal" || !o || o.tripId !== trip.id || o.tripRevision !== trip.revision) throw new TripResourceError("invalid-input");
    const writes: TransactWriteItem[] = [this.workPut(w, "done", now), { ConditionCheck: { TableName: this.tripTable, Key: key(p, `TRIP#${trip.id}`),
      ConditionExpression: "attribute_exists(pk) AND archived = :active AND trip = :trip", ExpressionAttributeValues: { ":active": { BOOL: false }, ":trip": { S: JSON.stringify(trip) } } } }];
    if (decision.episode) {
      const e = decision.episode; validateNotificationEpisode(e);
      if (e.tripId !== trip.id || e.tripRevision !== trip.revision || e.subjectKey !== o.subjectKey || e.version !== (previous?.version ?? -1) + 1) throw new TripResourceError("invalid-input");
      writes.push({ Put: { TableName: this.table, Item: { ...key(p, episodeKey(trip.id, trip.revision, o.subjectKey)), storageVersion: { N: "1" }, resourceVersion: { N: String(e.version) }, episode: { S: JSON.stringify(e) } },
        ConditionExpression: previous ? "resourceVersion = :version" : "attribute_not_exists(pk)", ...(previous ? { ExpressionAttributeValues: { ":version": { N: String(previous.version) } } } : {}) } });
    }
    if (decision.notification) {
      const n = decision.notification; validateNotification(n);
      if (n.tripId !== trip.id || n.tripRevision !== trip.revision || n.impactId !== o.impactId || n.id !== decision.episode?.latestNotificationId) throw new TripResourceError("invalid-input");
      writes.push({ Put: { TableName: this.table, Item: this.notificationRow(p, n), ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: this.table, Item: this.workRow({ key: { pk: pk(p), sk: `DELIVER#${n.id}` }, version: 0, attempt: 0, kind: "delivery", notificationId: n.id }, "pending", now), ConditionExpression: "attribute_not_exists(pk)" } });
    }
    // Low-cardinality audit outcome only; never save model prose, Event or Trip payload in work metadata.
    writes[0]!.Put!.Item!.decisionReason = { S: decision.reason };
    writes[0]!.Put!.Item!.decisionAction = { S: decision.action };
    await this.transaction(writes);
  }
  private notificationRow(p: TripPrincipal, n: TripNotification): Row {
    return { ...key(p, `NOTIFICATION#${n.id}`), storageVersion: { N: "1" }, resourceVersion: { N: String(n.version) }, notification: { S: JSON.stringify(n) } };
  }
  private notificationPut(p: TripPrincipal, before: TripNotification, after: TripNotification): TransactWriteItem {
    validateNotification(after);
    return { Put: { TableName: this.table, Item: this.notificationRow(p, after), ConditionExpression: "resourceVersion = :version", ExpressionAttributeValues: { ":version": { N: String(before.version) } } } };
  }
  async markRead(p: TripPrincipal, id: string, version: number, now: string) {
    const n = await this.get(p, id); if (!n) throw new TripResourceError("not-found");
    if (n.status === "read") return; // Lost acknowledgement is an idempotent read receipt.
    if (n.version !== version) throw new TripResourceError("conflict");
    await this.transaction([this.notificationPut(p, n, { ...n, version: n.version + 1, status: "read", readAt: now })]);
  }
  async completeDelivery(w: NotificationWork, n: TripNotification, status: "sent" | "suppressed" | "failed", now: string) {
    if (w.notificationId !== n.id) throw new TripResourceError("invalid-input");
    await this.transaction([this.workPut(w, status === "failed" ? "dead" : "done", Date.parse(now)),
      this.notificationPut({ subject: w.key.pk.slice(6) }, n, { ...n, version: n.version + 1, status: n.readAt ? "read" : status, ...(status === "sent" ? { sentAt: n.sentAt ?? now } : {}) })]);
  }
  /** Internal operator only. Old observations still pass current Trip/freshness checks, never become new facts. */
  async redrive(k: NotificationWorkKey, expectedVersion: number, now: number) {
    const row = await this.read(workKey(k));
    if (!row || row.workState?.S !== "dead" || integer(row.workVersion) !== expectedVersion || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER) throw new TripResourceError("conflict");
    const w: NotificationWork = { key: k, version: expectedVersion + 1, attempt: 0 };
    if (row.workKind?.S === "signal") { w.kind = "signal"; w.observation = this.parse(row, "observation", validateNotificationObservation); if (k.sk !== signalKey(w.observation.tripId, w.observation.subjectKey)) throw new TripResourceError("invalid-input"); }
    else if (row.workKind?.S === "delivery" && k.sk === `DELIVER#${opaque(row.notificationId?.S ?? "")}`) { w.kind = "delivery"; w.notificationId = row.notificationId!.S; }
    else throw new TripResourceError("invalid-input");
    await this.transaction([{ Put: { TableName: this.table, Item: this.workRow(w, "pending", now), ConditionExpression: "workVersion = :base AND workState = :dead",
      ExpressionAttributeValues: { ":base": { N: String(expectedVersion) }, ":dead": { S: "dead" } } } }]);
  }
}

/** Actual initial channel: durable in-app receipt. No browser permission or Push subscription required. */
export class DynamoDbInAppDelivery implements NotificationDelivery {
  constructor(private readonly table: string, private readonly tripTable: string, private readonly client: TripDynamoClient = new DynamoDBClient({ maxAttempts: 2, requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 } }), private readonly now = () => Date.now()) {}
  async send(p: TripPrincipal, n: TripNotification, idempotencyKey: string): Promise<"delivered" | "disabled"> {
    validateNotification(n); if (idempotencyKey !== n.dedupeKey) throw new TripResourceError("invalid-input");
    const repo = new DynamoDbNotificationRepository(this.table, this.tripTable, this.client);
    const o = await repo.observation(p, n.tripId, n.subjectKey), e = await repo.episode(p, n.tripId, n.tripRevision, n.subjectKey);
    if (!o || !e || !o.fresh || o.tripRevision !== n.tripRevision || o.impactId !== n.impactId || e.latestNotificationId !== n.id || e.latestImpactId !== n.impactId || Date.parse(o.expiresAt) <= this.now()) return "disabled";
    const trip = await new DynamoDbTripRepository(this.tripTable, this.client).get(p, n.tripId);
    if (!trip || trip.revision !== n.tripRevision) return "disabled";
    // Fence actual in-app delivery, not just the earlier decision. No network Push side effect.
    // Match Trip mutation CAS: #388 envelopes require exact validated JSON, never revision absence alone.
    // Preserve the repository's JSON.stringify format; sorting keys here would break stored JSON equality.
    await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
      { ConditionCheck: { TableName: this.tripTable, Key: key(p, `TRIP#${n.tripId}`),
        ConditionExpression: "attribute_exists(pk) AND archived = :active AND (revision = :revision OR (attribute_not_exists(revision) AND trip = :trip))",
        ExpressionAttributeValues: { ":active": { BOOL: false }, ":revision": { N: String(n.tripRevision) }, ":trip": { S: JSON.stringify(trip) } } } },
      { ConditionCheck: { TableName: this.table, Key: key(p, signalKey(n.tripId, n.subjectKey)), ConditionExpression: "observation = :observation", ExpressionAttributeValues: { ":observation": { S: JSON.stringify(o) } } } },
      { ConditionCheck: { TableName: this.table, Key: key(p, episodeKey(n.tripId, n.tripRevision, n.subjectKey)), ConditionExpression: "resourceVersion = :version", ExpressionAttributeValues: { ":version": { N: String(e.version) } } } },
      { Update: { TableName: this.table, Key: key(p, `INBOX#${opaque(n.id)}`),
      UpdateExpression: "SET storageVersion = :one, dedupeKey = :dedupe, notificationId = :id",
      ConditionExpression: "attribute_not_exists(pk) OR dedupeKey = :dedupe",
      ExpressionAttributeValues: { ":one": { N: "1" }, ":dedupe": { S: idempotencyKey }, ":id": { S: n.id } } } },
    ] }));
    return "delivered";
  }
}
