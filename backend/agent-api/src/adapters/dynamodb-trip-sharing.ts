import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand,
  type AttributeValue, type TransactWriteItem } from "@aws-sdk/client-dynamodb";
import type { Trip } from "@raiquora/trip/trip";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import { TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal } from "../contracts/trip-principal.js";
import type { ShareGrant, TripParticipant, TripSharingRepository, TripMutationGuard, ShareAbuseGuard } from "../ports/trip-authorization.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";

const memberKey = (subject: string, tripId: string) => ({ pk: { S: `PRINCIPAL#${subject}` }, sk: { S: `PARTICIPANT#${tripId}` } });
const grantKey = (id: string) => ({ pk: { S: `GRANT#${id}` }, sk: { S: `GRANT#${id}` } });
const scope = (owner: string, tripId: string) => JSON.stringify([owner, tripId]);
const tripFence = (table: string, owner: string, trip: Trip): TransactWriteItem => ({ ConditionCheck: {
  TableName: table, Key: { pk: { S: `OWNER#${owner}` }, sk: { S: `TRIP#${trip.id}` } },
  ConditionExpression: "attribute_exists(pk) AND archived = :active AND trip = :trip",
  ExpressionAttributeValues: { ":active": { BOOL: false }, ":trip": { S: JSON.stringify(trip) } },
} });
/** Same transaction as the Trip mutation, never a best-effort authorization read before a write. */
export function tripSharingFence(table: string, owner: TripPrincipal, tripId: string, guard: TripMutationGuard, now: string): TransactWriteItem[] {
  const { participant: m, grant: g } = guard;
  if (m.ownerSubject !== owner.subject || g.ownerSubject !== owner.subject || m.tripId !== tripId || g.tripId !== tripId ||
      m.grantId !== g.id || m.role !== "editor" || !m.active || g.revokedAt || g.expiresAt <= now) throw new TripResourceError("not-found");
  return [
    { ConditionCheck: { TableName: table, Key: memberKey(m.principalSubject, tripId), ConditionExpression: "payload = :expected",
      ExpressionAttributeValues: { ":expected": { S: JSON.stringify(m) } } } },
    grantFence(table, g, now),
  ];
}
function grantFence(table: string, g: ShareGrant, now: string): TransactWriteItem {
  return { ConditionCheck: { TableName: table, Key: grantKey(g.id),
    ConditionExpression: "payload = :expected AND expiresAt > :now AND revoked = :active",
    ExpressionAttributeValues: { ":expected": { S: JSON.stringify(g) }, ":now": { S: now }, ":active": { BOOL: false } } } };
}

/** Independent rows in the existing table. GSI keys are routing hints only, never authorization. */
export class DynamoDbTripSharing implements TripSharingRepository, ShareAbuseGuard {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({}),
    private readonly clock: TripClock = { now: () => new Date() }) {}
  private async send(command: Parameters<TripDynamoClient["send"]>[0]) {
    try { return await this.client.send(command); }
    catch (e) {
      const reasons = (e as { CancellationReasons?: { Code?: string }[] })?.CancellationReasons;
      throw new TripResourceError(reasons?.some((r) => r.Code === "ConditionalCheckFailed") || (e as Error)?.name === "ConditionalCheckFailedException" ? "conflict" : "unavailable");
    }
  }
  private record(value: ShareGrant | TripParticipant) {
    const isGrant = "secretHash" in value;
    return { ...(isGrant ? grantKey(value.id) : memberKey(value.principalSubject, value.tripId)),
      storageVersion: { N: "1" }, payload: { S: JSON.stringify(value) },
      shareTrip: { S: scope(value.ownerSubject, value.tripId) }, shareOrder: { S: `${isGrant ? "GRANT" : "PARTICIPANT"}#${value.id}` },
      ...(isGrant ? { expiresAt: { S: value.expiresAt }, revoked: { BOOL: !!value.revokedAt } } : {}) };
  }
  private decode(row: Record<string, AttributeValue>, isGrant: boolean): ShareGrant | TripParticipant {
    try {
      if (row.storageVersion?.N !== "1" || !row.payload?.S) throw new Error();
      const v = JSON.parse(row.payload.S) as ShareGrant & TripParticipant;
      tripIdentifier(v.id); tripIdentifier(v.tripId); requireTripPrincipal({ subject: v.ownerSubject });
      if (!Number.isSafeInteger(v.version) || v.version < 0 || v.version >= Number.MAX_SAFE_INTEGER || !["editor", "viewer"].includes(v.role)) throw new Error();
      const keys = ["id", "tripId", "ownerSubject", "role", "version", ...(isGrant
        ? ["secretHash", "createdAt", "expiresAt", "revokedAt"] : ["principalSubject", "grantId", "active", "joinedAt", "updatedAt"])];
      if (Object.keys(v).some((k) => !keys.includes(k))) throw new Error();
      const dates = isGrant ? [v.createdAt, v.expiresAt, ...(v.revokedAt ? [v.revokedAt] : [])] : [v.joinedAt, v.updatedAt];
      if (dates.some((d) => typeof d !== "string" || new Date(d).toISOString() !== d)) throw new Error();
      if (isGrant) { if (!/^[a-f0-9]{64}$/.test(v.secretHash) || row.expiresAt?.S !== v.expiresAt || row.revoked?.BOOL !== !!v.revokedAt) throw new Error(); }
      else { requireTripPrincipal({ subject: v.principalSubject }); tripIdentifier(v.grantId); if (typeof v.active !== "boolean") throw new Error(); }
      const expected = this.record(v);
      if (row.pk?.S !== expected.pk.S || row.sk?.S !== expected.sk.S || row.shareTrip?.S !== expected.shareTrip.S || row.shareOrder?.S !== expected.shareOrder.S) throw new Error();
      return v;
    } catch { throw new TripResourceError("unavailable"); }
  }
  async participant(principal: TripPrincipal, tripId: string) {
    requireTripPrincipal(principal); tripIdentifier(tripId);
    const key = memberKey(principal.subject, tripId);
    const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    if (!Item) return undefined;
    const result = this.decode(Item, false) as TripParticipant;
    if (result.principalSubject !== principal.subject || result.tripId !== tripId) throw new TripResourceError("unavailable");
    return result;
  }
  async grant(id: string) {
    tripIdentifier(id);
    const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: grantKey(id), ConsistentRead: true }));
    if (!Item) return undefined;
    const result = this.decode(Item, true) as ShareGrant;
    if (result.id !== id) throw new TripResourceError("unavailable");
    return result;
  }
  async createGrant(grant: ShareGrant, trip: Trip) {
    await this.send(new TransactWriteItemsCommand({ TransactItems: [tripFence(this.table, grant.ownerSubject, trip),
      { Put: { TableName: this.table, Item: this.record(grant), ConditionExpression: "attribute_not_exists(pk)" } }] }));
  }
  async replaceGrant(old: ShareGrant, next: ShareGrant) { await this.replace(old, next); }
  async replaceParticipant(old: TripParticipant, next: TripParticipant) { await this.replace(old, next); }
  private async replace(old: ShareGrant | TripParticipant, next: ShareGrant | TripParticipant) {
    await this.send(new PutItemCommand({ TableName: this.table, Item: this.record(next), ConditionExpression: "payload = :old",
      ExpressionAttributeValues: { ":old": { S: JSON.stringify(old) } } }));
  }
  async putParticipant(next: TripParticipant, old: TripParticipant | undefined, grant: ShareGrant, trip: Trip) {
    try {
      await this.send(new TransactWriteItemsCommand({ TransactItems: [tripFence(this.table, grant.ownerSubject, trip), grantFence(this.table, grant, this.clock.now().toISOString()),
        { Put: { TableName: this.table, Item: this.record(next), ConditionExpression: old ? "payload = :old" : "attribute_not_exists(pk)",
          ...(old ? { ExpressionAttributeValues: { ":old": { S: JSON.stringify(old) } } } : {}) } }] }));
    } catch (error) {
      // Response lost or concurrent identical redemption: still verify current grant + exact member.
      const m = await this.participant({ subject: next.principalSubject }, next.tripId), g = await this.grant(grant.id);
      const { Item: current } = await this.send(new GetItemCommand({ TableName: this.table, ConsistentRead: true,
        Key: { pk: { S: `OWNER#${next.ownerSubject}` }, sk: { S: `TRIP#${trip.id}` } } }));
      if (m?.active && m.grantId === next.grantId && m.ownerSubject === next.ownerSubject && m.role === next.role &&
          g && g.tripId === next.tripId && g.ownerSubject === next.ownerSubject && !g.revokedAt && g.expiresAt > this.clock.now().toISOString() &&
          current?.archived?.BOOL === false && current.trip?.S === JSON.stringify(trip)) return;
      throw error;
    }
  }
  async memberships(principal: TripPrincipal, after?: string) {
    requireTripPrincipal(principal); if (after) tripIdentifier(after);
    const { Items = [], LastEvaluatedKey } = await this.send(new QueryCommand({ TableName: this.table, ConsistentRead: true,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", Limit: 20,
      ExpressionAttributeValues: { ":pk": { S: `PRINCIPAL#${principal.subject}` }, ":prefix": { S: "PARTICIPANT#" } },
      ...(after ? { ExclusiveStartKey: memberKey(principal.subject, after) } : {}) }));
    const members: TripParticipant[] = [];
    for (const row of Items) {
      const candidate = this.decode(row, false) as TripParticipant;
      if (candidate.principalSubject !== principal.subject) throw new TripResourceError("unavailable");
      const base = await this.participant(principal, candidate.tripId); if (base) members.push(base);
    }
    const cursor = LastEvaluatedKey?.sk?.S?.slice("PARTICIPANT#".length);
    if (LastEvaluatedKey) { tripIdentifier(cursor); if (LastEvaluatedKey.pk?.S !== `PRINCIPAL#${principal.subject}`) throw new TripResourceError("unavailable"); }
    return { members, ...(cursor ? { after: cursor } : {}) };
  }
  async management(owner: TripPrincipal, tripId: string, after?: string) {
    requireTripPrincipal(owner); tripIdentifier(tripId);
    if (after && !/^(GRANT|PARTICIPANT)#[0-9a-f-]{36}$/i.test(after)) throw new TripResourceError("invalid-input");
    const { Items = [] } = await this.send(new QueryCommand({ TableName: this.table, IndexName: "trip-sharing", Limit: 20,
      KeyConditionExpression: `shareTrip = :scope${after ? " AND shareOrder > :after" : ""}`,
      ExpressionAttributeValues: { ":scope": { S: scope(owner.subject, tripId) }, ...(after ? { ":after": { S: after } } : {}) } }));
    const members: TripParticipant[] = [], grants: ShareGrant[] = [];
    for (const hint of Items) {
      const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: { pk: hint.pk!, sk: hint.sk! }, ConsistentRead: true }));
      if (!Item) continue;
      const isGrant = Item.pk?.S?.startsWith("GRANT#") ?? false, value = this.decode(Item, isGrant);
      if (value.ownerSubject !== owner.subject || value.tripId !== tripId) continue;
      if (isGrant) grants.push(value as ShareGrant); else members.push(value as TripParticipant);
    }
    return { members, grants, ...(Items.length === 20 ? { after: Items.at(-1)!.shareOrder!.S } : {}) };
  }
  async managedParticipant(owner: TripPrincipal, tripId: string, id: string) {
    requireTripPrincipal(owner); tripIdentifier(tripId); tripIdentifier(id);
    const { Items = [] } = await this.send(new QueryCommand({ TableName: this.table, IndexName: "trip-sharing", Limit: 2,
      KeyConditionExpression: "shareTrip = :scope AND shareOrder = :order", ExpressionAttributeValues: {
        ":scope": { S: scope(owner.subject, tripId) }, ":order": { S: `PARTICIPANT#${id}` } } }));
    if (Items.length !== 1) return undefined;
    const hint = Items[0]!;
    const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: { pk: hint.pk!, sk: hint.sk! }, ConsistentRead: true }));
    if (!Item) return undefined;
    const m = this.decode(Item, false) as TripParticipant;
    return m.id === id && m.ownerSubject === owner.subject && m.tripId === tripId ? m : undefined;
  }
  async consume(principal: TripPrincipal) {
    requireTripPrincipal(principal);
    // One rolling base row per principal, not an unbounded new record each minute.
    const window = Math.floor(this.clock.now().getTime() / 60_000);
    const key = { pk: { S: `PRINCIPAL#${principal.subject}` }, sk: { S: "SHARE-RATE" } };
    const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    const old = Item?.window?.N === String(window) ? Number(Item.count?.N) : 0;
    if (!Number.isSafeInteger(old) || old < 0 || old >= 30) throw new TripResourceError("unavailable");
    await this.send(new PutItemCommand({ TableName: this.table, Item: { ...key, window: { N: String(window) }, count: { N: String(old + 1) } },
      ConditionExpression: Item ? "#window = :window AND #count = :count" : "attribute_not_exists(pk)",
      ...(Item ? { ExpressionAttributeNames: { "#window": "window", "#count": "count" }, ExpressionAttributeValues: {
        ":window": Item.window!, ":count": Item.count! } } : {}) }));
  }
}
