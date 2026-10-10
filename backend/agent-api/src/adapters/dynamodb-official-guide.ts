import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";
import type { OfficialGuideRepository, OfficialGuideRecord } from "../ports/official-guide-repository.js";
import type { TripPrincipal } from "../contracts/trip-principal.js";
import type { Trip } from "@raiquora/trip/trip";
import { validateTrip } from "@raiquora/trip/trip";
import { tripChangedPut } from "./trip-changed-record.js";
import { requireTripPrincipal } from "../contracts/trip-principal.js";
import { validateOfficialGuide } from "@raiquora/trip/official-guide";
import { boundedTrip, TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
const key = (id: string) => { tripIdentifier(id); return { pk: { S: "OFFICIAL#CATALOG" }, sk: { S: `GUIDE#${id}` } }; };
export class DynamoDbOfficialGuide implements OfficialGuideRepository {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({})) {}
  private decode(payload: string): OfficialGuideRecord { const r = JSON.parse(payload) as OfficialGuideRecord; validateOfficialGuide(r.guide);
    if (!r.publisher || typeof r.active !== "boolean" || !Number.isSafeInteger(r.guide.version) || r.guide.version < 1 || r.guide.id !== r.guide.trip.id) throw new TripResourceError("unavailable"); return r; }
  async get(id: string) { const { Item } = await this.client.send(new GetItemCommand({ TableName: this.table, Key: key(id), ConsistentRead: true }));
    return Item?.payload?.S ? this.decode(Item.payload.S) : undefined; }
  async list(after?: string) { const r = await this.client.send(new QueryCommand({ TableName: this.table, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: { ":pk": { S: "OFFICIAL#CATALOG" }, ":prefix": { S: "GUIDE#" } }, Limit: 20, ConsistentRead: true, ...(after ? { ExclusiveStartKey: key(after) } : {}) }));
    const guides = (r.Items ?? []).map(row => this.decode(row.payload!.S!)).filter(r => r.active).map(r => r.guide);
    return { guides, ...(r.LastEvaluatedKey?.sk?.S ? { after: r.LastEvaluatedKey.sk.S.slice(6) } : {}) }; }
  async publish(owner: TripPrincipal, source: Trip, next: OfficialGuideRecord, previous?: OfficialGuideRecord) {
    if (next.publisher !== owner.subject || previous && previous.publisher !== owner.subject) throw new TripResourceError("not-found");
    try { await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
      { ConditionCheck: { TableName: this.table, Key: { pk: { S: `OWNER#${owner.subject}` }, sk: { S: `TRIP#${source.id}` } },
        ConditionExpression: "attribute_exists(pk) AND archived = :active AND trip = :trip", ExpressionAttributeValues: { ":active": { BOOL: false }, ":trip": { S: JSON.stringify(source) } } } },
      { Put: { TableName: this.table, Item: { ...key(next.guide.id), payload: { S: JSON.stringify(next) } },
        ConditionExpression: previous ? "payload = :old" : "attribute_not_exists(pk)", ...(previous ? { ExpressionAttributeValues: { ":old": { S: JSON.stringify(previous) } } } : {}) } },
    ] })); } catch (error) { this.transactionError(error); }
  }
  private transactionError(error: unknown): never {
    const reasons = (error as { CancellationReasons?: { Code?: string }[] })?.CancellationReasons;
    throw new TripResourceError(reasons?.some(r => r.Code === "ConditionalCheckFailed") ? "conflict" : "unavailable");
  }
  async import(principal: TripPrincipal, source: OfficialGuideRecord, input: Trip, requestKey: string): Promise<Trip> {
    requireTripPrincipal(principal); const trip = boundedTrip(input); tripIdentifier(trip.id);
    const tripKey = { pk: { S: `OWNER#${principal.subject}` }, sk: { S: `TRIP#${trip.id}` } };
    const receiptKey = { pk: tripKey.pk, sk: { S: `OFFICIAL_IMPORT#${trip.id}` } };
    const prior = async () => {
      const { Item } = await this.client.send(new GetItemCommand({ TableName: this.table, Key: receiptKey, ConsistentRead: true }));
      if (!Item) return undefined;
      if (Item.requestKey?.S !== requestKey) throw new TripResourceError("already-exists");
      const { Item: row } = await this.client.send(new GetItemCommand({ TableName: this.table, Key: tripKey, ConsistentRead: true }));
      if (!row || row.archived?.BOOL !== false || !row.trip?.S) throw new TripResourceError("not-found");
      const existing = JSON.parse(row.trip.S) as Trip; validateTrip(existing); return existing;
    };
    const existing = await prior(); if (existing) return existing;
    try { await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
      { ConditionCheck: { TableName: this.table, Key: key(source.guide.id), ConditionExpression: "payload = :expected", ExpressionAttributeValues: { ":expected": { S: JSON.stringify(source) } } } },
      { Put: { TableName: this.table, Item: { ...tripKey, storageVersion: { N: "1" }, revision: { N: "0" }, archived: { BOOL: false }, trip: { S: JSON.stringify(trip) } }, ConditionExpression: "attribute_not_exists(pk)" } },
      { Put: { TableName: this.table, Item: { ...receiptKey, requestKey: { S: requestKey } }, ConditionExpression: "attribute_not_exists(pk)" } },
      tripChangedPut(this.table, tripKey.pk.S, trip.id, 0, "created", trip.createdAt),
    ] })); } catch (error) { const committed = await prior(); if (committed) return committed; this.transactionError(error); }
    return trip;
  }
  async withdraw(owner: TripPrincipal, old: OfficialGuideRecord) {
    if (owner.subject !== old.publisher) throw new TripResourceError("not-found");
    try { await this.client.send(new TransactWriteItemsCommand({ TransactItems: [{ Put: { TableName: this.table,
      Item: { ...key(old.guide.id), payload: { S: JSON.stringify({ ...old, active: false }) } }, ConditionExpression: "payload = :old", ExpressionAttributeValues: { ":old": { S: JSON.stringify(old) } } } }] })); }
    catch (error) { this.transactionError(error); }
  }
}
