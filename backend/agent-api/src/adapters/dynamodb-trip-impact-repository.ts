import { createHash } from "node:crypto";
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { validateTripImpact, type TripImpact } from "@raiquora/trip/trip-impact";
import type { Trip } from "@raiquora/trip/trip";
import { boundedTrip, TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal } from "../contracts/trip-principal.js";
import type { TripImpactRepository } from "../ports/rail-impact-routing.js";
import { DynamoDbTripRepository, type TripDynamoClient } from "./dynamodb-trip-repository.js";

/** Separate owner resource, indefinite retention. No notification state or Trip mutation. */
export class DynamoDbTripImpactRepository implements TripImpactRepository {
  constructor(private readonly table: string, private readonly client: TripDynamoClient = new DynamoDBClient({})) {
    if (!table) throw new TripResourceError("unavailable");
  }
  private key(principal: TripPrincipal, tripId: string, id: string) {
    requireTripPrincipal(principal); tripIdentifier(tripId);
    if (typeof id !== "string" || !id || id.length > 250000) throw new TripResourceError("invalid-input");
    return { pk: { S: `OWNER#${principal.subject}` }, sk: { S: `IMPACT#${tripId}#${createHash("sha256").update(id).digest("hex")}` } };
  }
  async save(principal: TripPrincipal, input: Trip, impact: TripImpact) {
    const trip = boundedTrip(input); validateTripImpact(impact);
    const key = this.key(principal, trip.id, impact.id);
    if (impact.tripId !== trip.id || impact.tripRevision !== trip.revision ||
        impact.affectedItemIds.some((id) => !trip.items.some((i) => i.id === id))) throw new TripResourceError("invalid-input");
    if (trip.lifecycleState === "cancelled" || trip.lifecycleState === "completed") throw new TripResourceError("conflict");
    const encoded = JSON.stringify(impact);
    if (Buffer.byteLength(encoded, "utf8") > 250000) throw new TripResourceError("payload-too-large");
    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
        { ConditionCheck: { TableName: this.table, Key: { pk: key.pk, sk: { S: `TRIP#${trip.id}` } },
          ConditionExpression: "attribute_exists(pk) AND archived = :active AND trip = :trip",
          ExpressionAttributeValues: { ":active": { BOOL: false }, ":trip": { S: JSON.stringify(trip) } } } },
        { Put: { TableName: this.table, Item: { ...key, storageVersion: { N: "1" }, impact: { S: encoded }, impactId: { S: impact.id } },
          ConditionExpression: "attribute_not_exists(pk) OR impactId = :id", ExpressionAttributeValues: { ":id": { S: impact.id } } } },
      ] }));
    } catch (error) {
      if ((error as { CancellationReasons?: { Code?: string }[] })?.CancellationReasons?.some((r) => r.Code === "ConditionalCheckFailed" || r.Code === "TransactionConflict")) throw new TripResourceError("conflict");
      throw new TripResourceError("unavailable");
    }
  }
  async read(principal: TripPrincipal, tripId: string, impactId: string) {
    const key = this.key(principal, tripId, impactId);
    let item;
    try { item = (await this.client.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }))).Item; }
    catch { throw new TripResourceError("unavailable"); }
    if (!item) return undefined;
    let impact: TripImpact;
    try {
      if (item.pk?.S !== key.pk.S || item.sk?.S !== key.sk.S || item.storageVersion?.N !== "1" || !item.impact?.S ||
          Buffer.byteLength(item.impact.S, "utf8") > 250000) throw new Error();
      impact = JSON.parse(item.impact.S); validateTripImpact(impact);
      if (impact.id !== impactId || impact.tripId !== tripId || item.impactId?.S !== impact.id) throw new Error();
    } catch { throw new TripResourceError("unavailable"); }
    const trip = await new DynamoDbTripRepository(this.table, this.client).get(principal, tripId);
    return { impact, matchesTripRevision: !!trip && trip.revision === impact.tripRevision &&
      trip.lifecycleState !== "cancelled" && trip.lifecycleState !== "completed" && impact.affectedItemIds.every((id) => trip.items.some((i) => i.id === id)) };
  }
}
