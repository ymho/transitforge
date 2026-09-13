import { createHash } from "node:crypto";
import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { validateTripWatch, diffTripWatches, watchSubjectKey, monitoringKey, type StoredTripWatch, type WatchSubject } from "@raiquora/trip/trip-watch";
import type { Trip } from "@raiquora/trip/trip";
import { boundedTrip, TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";
import type { TripWatchRead, TripWatchRepository } from "../ports/trip-watch-repository.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";

type Attributes = Record<string, AttributeValue>;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const watchSubjectIndex = "watch-subject";
/** Bounded differential batches: 98 changes + collection CAS + saved-Trip ConditionCheck.
 * An unfinished collection is invisible to reverse lookup. Reconcile resumes from actual rows.
 */
export class DynamoDbTripWatchRepository implements TripWatchRepository {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({})) {
    if (!table) throw new TripResourceError("unavailable");
  }
  private scope(principal: TripPrincipal, tripId?: string) {
    requireTripPrincipal(principal); if (tripId !== undefined) tripIdentifier(tripId);
    return `OWNER#${principal.subject}`;
  }
  private stateKey(owner: string, tripId: string) { return { pk: { S: owner }, sk: { S: `WATCH_STATE#${tripId}` } }; }
  private watchKey(owner: string, record: StoredTripWatch) {
    return { pk: { S: owner }, sk: { S: `WATCH#${record.watch.tripId}#${digest(record.watch.id)}` } };
  }
  private subjectKey(owner: string, subject: WatchSubject) { return digest(monitoringKey([owner, watchSubjectKey(subject)])); }
  private async state(owner: string, tripId: string) {
    const key = this.stateKey(owner, tripId);
    const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    if (!Item) return { version: 0, complete: false };
    const version = Number(Item.version?.N), sourceTripRevision = Number(Item.sourceTripRevision?.N);
    if (Item.pk?.S !== owner || Item.sk?.S !== key.sk.S || Item.storageVersion?.N !== "1" ||
        !Number.isSafeInteger(version) || version < 1 || String(version) !== Item.version?.N ||
        !Number.isSafeInteger(sourceTripRevision) || sourceTripRevision < 0 || String(sourceTripRevision) !== Item.sourceTripRevision?.N ||
        typeof Item.complete?.BOOL !== "boolean") throw new TripResourceError("unavailable");
    return { version, sourceTripRevision, complete: Item.complete.BOOL };
  }
  private decode(raw: Attributes, owner: string): StoredTripWatch {
    try {
      if (!raw.watch?.S || raw.watch.S.length > 16000 || raw.storageVersion?.N !== "1" || typeof raw.active?.BOOL !== "boolean") throw new Error();
      const watch = JSON.parse(raw.watch.S);
      validateTripWatch(watch); tripIdentifier(watch.tripId);
      const record = { watch, active: raw.active.BOOL }, key = this.watchKey(owner, record);
      if (raw.pk?.S !== owner || raw.sk?.S !== key.sk.S || raw.sourceTripRevision?.N !== String(watch.sourceTripRevision) ||
          (record.active ? raw.watchSubject?.S !== this.subjectKey(owner, watch.subject) : raw.watchSubject !== undefined)) throw new Error();
      return record;
    } catch { throw new TripResourceError("unavailable"); }
  }
  async read(principal: TripPrincipal, tripId: string): Promise<TripWatchRead> {
    const owner = this.scope(principal, tripId), before = await this.state(owner, tripId);
    const rows = await this.query(owner, `WATCH#${tripId}#`);
    const records = rows.map((r) => this.decode(r, owner));
    if (records.some((r) => r.watch.tripId !== tripId) || monitoringKey(await this.state(owner, tripId)) !== monitoringKey(before) ||
        !before.version && records.length || new Set(records.map((r) => r.watch.id)).size !== records.length) throw new TripResourceError("conflict");
    if (records.some((r) => before.sourceTripRevision === undefined || r.watch.sourceTripRevision > before.sourceTripRevision ||
        before.complete && r.active && r.watch.sourceTripRevision !== before.sourceTripRevision)) throw new TripResourceError("unavailable");
    return { ...before, records };
  }
  async find(principal: TripPrincipal, subject: WatchSubject): Promise<StoredTripWatch[]> {
    const owner = this.scope(principal), subjectKey = this.subjectKey(owner, subject);
    const indexed = await this.query(owner, "WATCH#", subjectKey), records: StoredTripWatch[] = [];
    const seen = new Set<string>();
    for (const row of indexed) {
      // Sparse GSI is KEYS_ONLY and may lag. Re-read a version-checked whole collection so
      // mixed batches/same-revision scope replacement cannot masquerade as a complete snapshot.
      const match = /^WATCH#([0-9a-f-]{36})#[0-9a-f]{64}$/iu.exec(row.sk?.S ?? "");
      if (!match) throw new TripResourceError("unavailable");
      const tripId = match[1]!;
      if (seen.has(tripId)) continue;
      seen.add(tripId);
      const state = await this.read(principal, tripId);
      if (state.complete) records.push(...state.records.filter((r) => r.active &&
        r.watch.sourceTripRevision === state.sourceTripRevision && watchSubjectKey(r.watch.subject) === watchSubjectKey(subject)));
    }
    return records;
  }
  async commit(principal: TripPrincipal, tripId: string, base: TripWatchRead, input: Trip | undefined, writes: readonly StoredTripWatch[]): Promise<void> {
    const owner = this.scope(principal, tripId), trip = input === undefined ? undefined : boundedTrip(input);
    const revision = trip?.revision ?? base.sourceTripRevision;
    if (trip && trip.id !== tripId || revision === undefined || !Number.isSafeInteger(base.version) || base.version < 0 || base.version >= Number.MAX_SAFE_INTEGER ||
        base.sourceTripRevision !== undefined && base.sourceTripRevision > revision) throw new TripResourceError("conflict");
    if (writes.length > 1000) throw new TripResourceError("payload-too-large");
    try {
      // Validate full resulting collection, no duplicate references or future revisions accepted.
      const next = new Map(base.records.map((r) => [r.watch.id, r]));
      if (new Set(writes.map((r) => r.watch.id)).size !== writes.length) throw new Error();
      for (const record of writes) {
        validateTripWatch(record.watch);
        if (Buffer.byteLength(JSON.stringify(record.watch), "utf8") > 16000) throw new TripResourceError("payload-too-large");
        if (record.active && (!trip || record.watch.sourceTripRevision !== revision || !trip.items.some((item) => item.id === record.watch.itineraryItemId))) throw new Error();
        next.set(record.watch.id, record);
      }
      if (next.size > 1000) throw new TripResourceError("payload-too-large");
      diffTripWatches(tripId, revision, [...next.values()], [...next.values()].filter((r) => r.active).map((r) => r.watch));
    } catch (error) { if (error instanceof TripResourceError) throw error; throw new TripResourceError("invalid-input"); }
    const tripKey = { pk: { S: owner }, sk: { S: `TRIP#${tripId}` } };
    // #388 legacy envelopes may lack the redundant revision attribute; exact JSON guards both formats.
    const guard: { ConditionExpression: string; ExpressionAttributeValues: Attributes } = trip ? {
      ConditionExpression: "attribute_exists(pk) AND archived = :active AND trip = :trip",
      ExpressionAttributeValues: { ":active": { BOOL: false }, ":trip": { S: JSON.stringify(trip) } },
    } : { ConditionExpression: "attribute_not_exists(pk) OR archived = :archived", ExpressionAttributeValues: { ":archived": { BOOL: true } } };
    const state = this.stateKey(owner, tripId);
    // Each batch commits its rows and publication marker atomically. Crash/retry reads partial rows
    // and computes the remaining difference. A competing sync invalidates this version, including same-revision work.
    const batches = Array.from({ length: Math.max(1, Math.ceil(writes.length / 98)) }, (_, i) => writes.slice(i * 98, (i + 1) * 98));
    for (const [index, batch] of batches.entries()) {
      const version = base.version + index;
      if (!Number.isSafeInteger(version + 1)) throw new TripResourceError("conflict");
      await this.send(new TransactWriteItemsCommand({ TransactItems: [
        { ConditionCheck: { TableName: this.table, Key: tripKey, ...guard } },
        { Put: { TableName: this.table, Item: { ...state, storageVersion: { N: "1" }, version: { N: String(version + 1) }, sourceTripRevision: { N: String(revision) }, complete: { BOOL: index === batches.length - 1 } },
          ConditionExpression: version === 0 ? "attribute_not_exists(pk)" : "#version = :base",
          ...(version === 0 ? {} : { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":base": { N: String(version) } } }) } },
        ...batch.map((record) => ({ Put: { TableName: this.table, Item: {
          ...this.watchKey(owner, record), storageVersion: { N: "1" }, sourceTripRevision: { N: String(record.watch.sourceTripRevision) },
          active: { BOOL: record.active }, watch: { S: JSON.stringify(record.watch) },
          ...(record.active ? { watchSubject: { S: this.subjectKey(owner, record.watch.subject) } } : {}),
        } } })),
      ] }));
    }
  }
  private async query(owner: string, prefix: string, subject?: string): Promise<Attributes[]> {
    let cursor: Attributes | undefined;
    const rows: Attributes[] = [], cursors = new Set<string>();
    do {
      const page = await this.send(new QueryCommand({ TableName: this.table,
        ...(subject ? { IndexName: watchSubjectIndex } : { ConsistentRead: true }), Limit: 100,
        KeyConditionExpression: subject ? "watchSubject = :subject" : "pk = :owner AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: subject ? { ":subject": { S: subject } } : { ":owner": { S: owner }, ":prefix": { S: prefix } },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
      for (const row of page.Items ?? []) {
        if (row.pk?.S !== owner || !row.sk?.S?.startsWith(prefix) || subject && row.watchSubject?.S !== subject) throw new TripResourceError("unavailable");
        rows.push(row);
      }
      if (rows.length > 1000) throw new TripResourceError("payload-too-large");
      cursor = page.LastEvaluatedKey;
      if (cursor) {
        const key = monitoringKey(cursor);
        if (cursor.pk?.S !== owner || !cursor.sk?.S?.startsWith(prefix) || subject && cursor.watchSubject?.S !== subject || cursors.has(key) || cursors.size >= 100) throw new TripResourceError("unavailable");
        cursors.add(key);
      }
    } while (cursor);
    return rows;
  }
  private async send(command: GetItemCommand | QueryCommand | TransactWriteItemsCommand) {
    try { return await this.client.send(command); }
    catch (error) {
      const reasons = (error as { CancellationReasons?: { Code?: string }[] })?.CancellationReasons;
      if (reasons?.some((r) => r.Code === "ConditionalCheckFailed" || r.Code === "TransactionConflict")) throw new TripResourceError("conflict");
      throw new TripResourceError("unavailable");
    }
  }
}
