import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { validateChecklistItems, type TripChecklistItem } from "@raiquora/trip/trip-checklist";
import { TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";
import type { ChecklistRepository, ChecklistWrite } from "../ports/checklist-repository.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";

/** Separate resources in the existing encrypted Trip table. No global Scan or cascade delete.
 * Collection CAS serializes exact-key dedupe against add/rename/archive in another request;
 * per-item CAS remains independent of Trip/Reservation revisions.
 */
export class DynamoDbChecklistRepository implements ChecklistRepository {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({})) {
    if (!table) throw new TripResourceError("unavailable");
  }
  private scope(principal: TripPrincipal, tripId: string) {
    requireTripPrincipal(principal); tripIdentifier(tripId);
    return { owner: `OWNER#${principal.subject}`, prefix: `CHECKLIST#${tripId}#`,
      state: { pk: { S: `OWNER#${principal.subject}` }, sk: { S: `CHECKLIST_STATE#${tripId}` } } };
  }
  private async version(key: Record<string, AttributeValue>): Promise<number> {
    const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    if (!Item) return 0;
    const version = Number(Item.version?.N);
    if (Item.pk?.S !== key.pk!.S || Item.sk?.S !== key.sk!.S || Item.storageVersion?.N !== "1" ||
      !Number.isSafeInteger(version) || version < 1 || String(version) !== Item.version?.N) throw new TripResourceError("unavailable");
    return version;
  }
  async read(principal: TripPrincipal, tripId: string) {
    const scope = this.scope(principal, tripId), version = await this.version(scope.state);
    const items: TripChecklistItem[] = [], cursors = new Set<string>();
    let cursor: Record<string, AttributeValue> | undefined;
    do {
      const page = await this.send(new QueryCommand({ TableName: this.table, ConsistentRead: true, Limit: 100,
        KeyConditionExpression: "pk = :owner AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":owner": { S: scope.owner }, ":prefix": { S: scope.prefix } },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
      for (const raw of page.Items ?? []) {
        try {
          if (!raw.checklist?.S || raw.checklist.S.length > 5000) throw new Error();
          const item = JSON.parse(raw.checklist.S) as TripChecklistItem;
          validateChecklistItems(tripId, [item]);
          if (raw.pk?.S !== scope.owner || raw.sk?.S !== `${scope.prefix}${item.id}` || raw.storageVersion?.N !== "1" || raw.revision?.N !== String(item.revision)) throw new Error();
          items.push(item);
        } catch { throw new TripResourceError("unavailable"); }
      }
      if (items.length > 1000) throw new TripResourceError("payload-too-large");
      cursor = page.LastEvaluatedKey;
      if (cursor) {
        if (cursor.pk?.S !== scope.owner || !cursor.sk?.S?.startsWith(scope.prefix) || cursors.has(cursor.sk.S)) throw new TripResourceError("unavailable");
        try { tripIdentifier(cursor.sk.S.slice(scope.prefix.length)); } catch { throw new TripResourceError("unavailable"); }
        cursors.add(cursor.sk.S);
        if (cursors.size > 100) throw new TripResourceError("unavailable");
      }
    } while (cursor);
    if (await this.version(scope.state) !== version) throw new TripResourceError("conflict");
    try { validateChecklistItems(tripId, items); } catch { throw new TripResourceError("unavailable"); }
    if (version === 0 && items.length) throw new TripResourceError("unavailable");
    return { version, items };
  }
  async commit(principal: TripPrincipal, tripId: string, version: number, writes: readonly ChecklistWrite[]) {
    const scope = this.scope(principal, tripId);
    if (!Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER || !writes.length || writes.length > 12) throw new TripResourceError("invalid-input");
    try { validateChecklistItems(tripId, writes.map((w) => w.item)); } catch { throw new TripResourceError("invalid-input"); }
    for (const w of writes) {
      if (w.baseRevision === undefined ? w.item.revision !== 0 : !Number.isSafeInteger(w.baseRevision) || w.baseRevision < 0 || w.baseRevision >= Number.MAX_SAFE_INTEGER || w.item.revision !== w.baseRevision + 1) throw new TripResourceError("invalid-input");
    }
    await this.send(new TransactWriteItemsCommand({ TransactItems: [
      { Put: { TableName: this.table, Item: { ...scope.state, storageVersion: { N: "1" }, version: { N: String(version + 1) } },
        ConditionExpression: version === 0 ? "attribute_not_exists(pk)" : "attribute_exists(pk) AND #version = :base",
        ...(version ? { ExpressionAttributeNames: { "#version": "version" }, ExpressionAttributeValues: { ":base": { N: String(version) } } } : {}) } },
      ...writes.map(({ item, baseRevision }) => ({ Put: { TableName: this.table,
        Item: { pk: { S: scope.owner }, sk: { S: `${scope.prefix}${item.id}` }, storageVersion: { N: "1" }, revision: { N: String(item.revision) }, checklist: { S: JSON.stringify(item) } },
        ConditionExpression: baseRevision === undefined ? "attribute_not_exists(pk)" : "attribute_exists(pk) AND revision = :base",
        ...(baseRevision !== undefined ? { ExpressionAttributeValues: { ":base": { N: String(baseRevision) } } } : {}) } })),
    ] }));
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
