import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, DeleteItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import type { Trip } from "@raiquora/trip/trip";
import { boundedTrip, tripIdentifier, conversationIdentifier, TripResourceError, validateMutation, type TripMutation } from "../contracts/trip-api.js";
import { canonicalJson, mutationDigest, readReceipt } from "./trip-mutation-receipt.js";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import { requireTripPrincipal, type TripPrincipal, type TripRepository, type TripConversationReferences } from "../ports/trip-repository.js";

type Command = GetItemCommand | PutItemCommand | UpdateItemCommand | DeleteItemCommand | QueryCommand | TransactWriteItemsCommand;
type Result = { Item?: Record<string, AttributeValue>; Items?: Record<string, AttributeValue>[]; LastEvaluatedKey?: Record<string, AttributeValue> };
export interface TripDynamoClient { send(command: Command): Promise<Result> }
/** Storage v1 envelope; Trip is unchanged. Archive is storage visibility, not lifecycle completion. */
export class DynamoDbTripRepository implements TripRepository, TripConversationReferences {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({}),
    private readonly clock: TripClock = { now: () => new Date() }) {
    if (!table) throw new TripResourceError("unavailable");
  }
  private owner(principal: TripPrincipal): string {
    requireTripPrincipal(principal);
    return `OWNER#${principal.subject}`;
  }
  private key(principal: TripPrincipal, id: string) {
    const pk = this.owner(principal); tripIdentifier(id);
    return { pk: { S: pk }, sk: { S: `TRIP#${id}` } };
  }
  private linkKey(principal: TripPrincipal, id: string) {
    const pk = this.owner(principal); conversationIdentifier(id);
    return { pk: { S: pk }, sk: { S: `CONVERSATION#${id}` } };
  }
  async create(principal: TripPrincipal, input: Trip): Promise<Trip> {
    requireTripPrincipal(principal);
    const trip = boundedTrip(input), key = this.key(principal, trip.id);
    if (trip.revision !== 0) throw new TripResourceError("invalid-input");
    try {
      await this.send(new PutItemCommand({ TableName: this.table, Item: { ...key, storageVersion: { N: "1" }, revision: { N: "0" }, archived: { BOOL: false }, trip: { S: JSON.stringify(trip) } },
        ConditionExpression: "attribute_not_exists(pk)" }), "already-exists");
    } catch (error) {
      // Stable UUID is create/import's idempotency key. Never replace a different/archived record.
      if (!(error instanceof TripResourceError) || error.code !== "already-exists") throw error;
      const existing = await this.get(principal, trip.id);
      if (!existing || canonicalJson(existing) !== canonicalJson(trip)) throw error;
      return existing;
    }
    return trip;
  }
  async get(principal: TripPrincipal, id: string): Promise<Trip | undefined> {
    const key = this.key(principal, id);
    const result = await this.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    return result.Item ? this.decode(result.Item, key.pk.S, id) : undefined;
  }
  async list(principal: TripPrincipal, options: { limit?: number; afterTripId?: string } = {}) {
    const pk = this.owner(principal), limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new TripResourceError("invalid-input");
    const result = await this.send(new QueryCommand({ TableName: this.table, KeyConditionExpression: "pk = :owner AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":owner": { S: pk }, ":prefix": { S: "TRIP#" } }, Limit: limit, ConsistentRead: true,
      ...(options.afterTripId ? { ExclusiveStartKey: this.key(principal, options.afterTripId) } : {}) }));
    const trips = (result.Items ?? []).flatMap((item) => { const trip = this.decode(item, pk); return trip ? [trip] : []; });
    const last = result.LastEvaluatedKey;
    if (last && (last.pk?.S !== pk || !last.sk?.S?.startsWith("TRIP#"))) throw new TripResourceError("unavailable");
    const nextAfterTripId = last?.sk?.S?.slice(5);
    if (nextAfterTripId) tripIdentifier(nextAfterTripId);
    return { trips, ...(nextAfterTripId ? { nextAfterTripId } : {}) };
  }
  async applyMutation(principal: TripPrincipal, mutation: TripMutation, prepare: (current: Trip) => Trip): Promise<Trip> {
    requireTripPrincipal(principal);
    validateMutation(mutation);
    mutation = structuredClone(mutation);
    const key = this.key(principal, mutation.tripId);
    const receiptKey = { pk: key.pk, sk: { S: `MUTATION#${mutation.mutationId}` } };
    const receipt = async () => {
      const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: receiptKey, ConsistentRead: true }));
      return Item ? readReceipt(Item, key.pk.S, mutation) : undefined;
    };
    // Owner visibility is checked even on retries; archived resources cannot be mutated/revealed.
    const old = await this.get(principal, mutation.tripId);
    if (!old) throw new TripResourceError("not-found");
    const prior = await receipt();
    if (prior) return prior;
    if (old.revision !== mutation.baseRevision) throw new TripResourceError("conflict");
    const preview = boundedTrip(prepare(structuredClone(old)));
    if (preview.id !== old.id || preview.createdAt !== old.createdAt || preview.revision !== old.revision || preview.updatedAt !== old.updatedAt) throw new TripResourceError("invalid-input");
    const trip = boundedTrip({ ...preview, revision: mutation.baseRevision + 1, updatedAt: this.clock.now().toISOString() });
    if (Date.parse(trip.updatedAt) < Date.parse(old.updatedAt)) throw new TripResourceError("unavailable");
    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
        { Update: { TableName: this.table, Key: key, UpdateExpression: "SET trip = :trip, revision = :next",
          // Old #388 envelopes have no revision attribute: exact old JSON also provides atomic CAS.
          ConditionExpression: "attribute_exists(pk) AND archived = :active AND (revision = :base OR (attribute_not_exists(revision) AND trip = :old))",
          ExpressionAttributeValues: { ":trip": { S: JSON.stringify(trip) }, ":next": { N: String(trip.revision) },
            ":base": { N: String(mutation.baseRevision) }, ":old": { S: JSON.stringify(old) }, ":active": { BOOL: false } } } },
        { Put: { TableName: this.table, Item: { ...receiptKey, storageVersion: { N: "1" }, digest: { S: mutationDigest(mutation) }, trip: { S: JSON.stringify(trip) } },
          ConditionExpression: "attribute_not_exists(pk)" } },
      ] }));
    } catch (error) {
      // Handles duplicate concurrent requests AND a committed transaction whose response was lost.
      if (!await this.get(principal, mutation.tripId)) throw new TripResourceError("not-found");
      const committed = await receipt();
      if (committed) return committed;
      const reasons = (error as { CancellationReasons?: { Code?: string }[] })?.CancellationReasons;
      if (reasons?.some((r) => r.Code === "ConditionalCheckFailed")) throw new TripResourceError("conflict");
      throw new TripResourceError("unavailable");
    }
    return trip;
  }
  async archive(principal: TripPrincipal, id: string): Promise<void> {
    await this.send(new UpdateItemCommand({ TableName: this.table, Key: this.key(principal, id),
      UpdateExpression: "SET archived = :archived", ConditionExpression: "attribute_exists(pk) AND archived = :active",
      ExpressionAttributeValues: { ":archived": { BOOL: true }, ":active": { BOOL: false } } }), "not-found");
  }
  async attach(principal: TripPrincipal, conversationId: string, tripId: string): Promise<void> {
    const key = this.linkKey(principal, conversationId);
    if (!await this.get(principal, tripId)) throw new TripResourceError("not-found");
    await this.send(new PutItemCommand({ TableName: this.table, Item: { ...key, storageVersion: { N: "1" }, tripId: { S: tripId } } }));
  }
  async detach(principal: TripPrincipal, conversationId: string): Promise<void> {
    await this.send(new DeleteItemCommand({ TableName: this.table, Key: this.linkKey(principal, conversationId) }));
  }
  async reference(principal: TripPrincipal, conversationId: string): Promise<string | undefined> {
    const key = this.linkKey(principal, conversationId);
    const { Item: item } = await this.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    if (!item) return undefined;
    if (item.pk?.S !== key.pk.S || item.sk?.S !== key.sk.S || item.storageVersion?.N !== "1") throw new TripResourceError("unavailable");
    tripIdentifier(item.tripId?.S);
    return item.tripId.S; // Dangling/archive reference remains visible; following it returns not-found.
  }
  private decode(item: Record<string, AttributeValue>, owner: string, id?: string): Trip | undefined {
    if (item.pk?.S !== owner || item.storageVersion?.N !== "1" || typeof item.archived?.BOOL !== "boolean" || typeof item.trip?.S !== "string") throw new TripResourceError("unavailable");
    try {
      const trip = boundedTrip(JSON.parse(item.trip.S));
      if (item.revision && item.revision.N !== String(trip.revision)) throw new Error();
      if (item.sk?.S !== `TRIP#${trip.id}` || id !== undefined && trip.id !== id) throw new Error();
      return item.archived.BOOL ? undefined : trip;
    } catch { throw new TripResourceError("unavailable"); }
  }
  private async send(command: Command, conditional?: "not-found" | "already-exists"): Promise<Result> {
    try { return await this.client.send(command); }
    catch (error) {
      if (conditional && error instanceof Error && error.name === "ConditionalCheckFailedException") throw new TripResourceError(conditional);
      throw new TripResourceError("unavailable");
    }
  }
}
