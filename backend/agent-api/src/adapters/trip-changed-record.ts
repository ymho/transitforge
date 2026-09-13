import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { tripChangedId, validateTripChanged, type TripChanged } from "../contracts/trip-changed.js";
import { tripChangedDelivery } from "../ports/trip-changed-outbox.js";
import { TripResourceError } from "../contracts/trip-api.js";

export function outboxShard(eventId: string, state = "pending"): string {
  return `${state}#${parseInt(eventId.slice(0, 8), 16) % tripChangedDelivery.shards}`;
}
/** The only writer constructor; part of the Trip transaction, no asynchronous dual-write. */
export function tripChangedPut(table: string, ownerKey: string, tripId: string, revision: number,
  kind: TripChanged["kind"], changedAt: string) {
  if (!ownerKey.startsWith("OWNER#")) throw new TripResourceError("invalid-input");
  const event: TripChanged = { eventId: tripChangedId(tripId, revision, kind), ownerSubject: ownerKey.slice(6), tripId, revision, kind, changedAt };
  validateTripChanged(event);
  const Item: Record<string, AttributeValue> = {
    pk: { S: ownerKey }, sk: { S: `TRIP_CHANGED#${event.eventId}` },
    storageVersion: { N: "1" }, event: { S: JSON.stringify(event) }, deliveryVersion: { N: "0" },
    attempts: { N: "0" }, deliveryState: { S: "pending" }, outboxShard: { S: outboxShard(event.eventId) },
    availableAt: { N: String(Date.parse(changedAt)) },
  };
  return { Put: { TableName: table, Item, ConditionExpression: "attribute_not_exists(pk)" } };
}
