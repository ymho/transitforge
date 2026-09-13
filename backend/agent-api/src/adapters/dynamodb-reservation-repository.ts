import { DynamoDBClient, GetItemCommand, PutItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import type { Reservation } from "@raiquora/trip/reservation";
import { boundedReservation } from "../contracts/reservation-api.js";
import { TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";
import type { ReservationRepository } from "../ports/reservation-repository.js";
import type { TripDynamoClient } from "./dynamodb-trip-repository.js";
import { canonicalJson } from "./trip-mutation-receipt.js";

/** Separate namespace in the encrypted Trip table, without a delete or scan path. */
export class DynamoDbReservationRepository implements ReservationRepository {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({})) {
    if (!table) throw new TripResourceError("unavailable");
  }
  private key(principal: TripPrincipal, tripId: string, id: string) {
    requireTripPrincipal(principal); tripIdentifier(tripId); tripIdentifier(id);
    return { pk: { S: `OWNER#${principal.subject}` }, sk: { S: `RESERVATION#${tripId}#${id}` } };
  }
  private decode(item: Record<string, AttributeValue>, principal: TripPrincipal, tripId: string, id?: string): Reservation {
    try {
      const r = boundedReservation(JSON.parse(item.reservation!.S!));
      const key = this.key(principal, tripId, r.id);
      if (r.tripId !== tripId || id !== undefined && r.id !== id || item.pk?.S !== key.pk.S || item.sk?.S !== key.sk.S ||
        item.storageVersion?.N !== "1" || item.revision?.N !== String(r.revision)) throw new Error();
      return r;
    } catch { throw new TripResourceError("unavailable"); }
  }
  async get(principal: TripPrincipal, tripId: string, id: string) {
    const key = this.key(principal, tripId, id);
    const { Item } = await this.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    return Item ? this.decode(Item, principal, tripId, id) : undefined;
  }
  async list(principal: TripPrincipal, tripId: string): Promise<Reservation[]> {
    requireTripPrincipal(principal); tripIdentifier(tripId);
    const owner = `OWNER#${principal.subject}`, prefix = `RESERVATION#${tripId}#`;
    const reservations: Reservation[] = [], cursors = new Set<string>();
    let cursor: Record<string, AttributeValue> | undefined;
    do {
      const page = await this.send(new QueryCommand({ TableName: this.table, ConsistentRead: true, Limit: 100,
        KeyConditionExpression: "pk = :owner AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":owner": { S: owner }, ":prefix": { S: prefix } },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}) }));
      reservations.push(...(page.Items ?? []).map((i) => this.decode(i, principal, tripId)));
      cursor = page.LastEvaluatedKey;
      if (reservations.length > 1000) throw new TripResourceError("payload-too-large");
      if (cursor) {
        const id = cursor.sk?.S?.slice(prefix.length);
        if (cursor.pk?.S !== owner || !cursor.sk?.S?.startsWith(prefix) || cursors.has(cursor.sk.S)) throw new TripResourceError("unavailable");
        try { tripIdentifier(id); } catch { throw new TripResourceError("unavailable"); }
        cursors.add(cursor.sk.S);
        if (cursors.size > 100) throw new TripResourceError("unavailable");
      }
    } while (cursor);
    if (new Set(reservations.map((r) => r.id)).size !== reservations.length) throw new TripResourceError("unavailable");
    return reservations;
  }
  async create(principal: TripPrincipal, input: Reservation) {
    requireTripPrincipal(principal);
    const r = boundedReservation(input);
    if (r.revision !== 0) throw new TripResourceError("invalid-input");
    const key = this.key(principal, r.tripId, r.id);
    try { await this.send(new PutItemCommand({ TableName: this.table, Item: this.encode(key, r), ConditionExpression: "attribute_not_exists(pk)" }), "already-exists"); }
    catch (error) {
      // Stable import ID: identical content only, never overwrite a different booking.
      if (!(error instanceof TripResourceError) || error.code !== "already-exists") throw error;
      const previous = await this.get(principal, r.tripId, r.id);
      if (!previous || canonicalJson(previous) !== canonicalJson(r)) throw error;
      return previous;
    }
    return r;
  }
  async replace(principal: TripPrincipal, input: Reservation, baseRevision: number) {
    requireTripPrincipal(principal);
    const r = boundedReservation(input), key = this.key(principal, r.tripId, r.id);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || baseRevision >= Number.MAX_SAFE_INTEGER || r.revision !== baseRevision) throw new TripResourceError("invalid-input");
    const updated = boundedReservation({ ...r, revision: baseRevision + 1 });
    await this.send(new PutItemCommand({ TableName: this.table, Item: this.encode(key, updated),
      ConditionExpression: "attribute_exists(pk) AND revision = :base", ExpressionAttributeValues: { ":base": { N: String(baseRevision) } } }), "conflict");
    return updated;
  }
  private encode(key: Record<string, AttributeValue>, r: Reservation) {
    return { ...key, storageVersion: { N: "1" }, revision: { N: String(r.revision) }, reservation: { S: JSON.stringify(r) } };
  }
  private async send(command: GetItemCommand | PutItemCommand | QueryCommand, conditional?: "already-exists" | "conflict") {
    try { return await this.client.send(command); }
    catch (error) {
      if (conditional && error instanceof Error && error.name === "ConditionalCheckFailedException") throw new TripResourceError(conditional);
      throw new TripResourceError("unavailable");
    }
  }
}
