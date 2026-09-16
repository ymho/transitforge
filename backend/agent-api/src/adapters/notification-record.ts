import { createHash } from "node:crypto";
import { type TransactWriteItem } from "@aws-sdk/client-dynamodb";
import { validateTravelEvent, type TravelEvent } from "@raiquora/trip/travel-event";
import { watchSubjectKey, monitoringKey } from "@raiquora/trip/trip-watch";
import { notificationPolicyVersion, observationOrder, type ImpactNotificationObservation } from "@raiquora/trip/notification";
import type { TripImpact } from "@raiquora/trip/trip-impact";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";

export const notificationHash = (text: string) => createHash("sha256").update(text).digest("hex");
export const notificationShard = (sk: string, state = "pending") => `${state}#${parseInt(notificationHash(sk).slice(0, 2), 16) % 4}`;
export const signalKey = (tripId: string, subject: string) => `SIGNAL#${tripId}#${notificationHash(subject)}`;
export const episodeKey = (tripId: string, revision: number, subject: string) => `EPISODE#${tripId}#${revision}#${notificationHash(JSON.stringify([notificationPolicyVersion, subject]))}`;
/** Atomic latest-observation + decision outbox. Coalesces undelivered transient states, not historical impacts. */
export function notificationSignalWrite(table: string, principal: TripPrincipal, impact: TripImpact, event: TravelEvent): TransactWriteItem {
  requireTripPrincipal(principal); validateTravelEvent(event);
  if (event.id !== impact.eventId || Date.parse(event.observedAt) > Date.parse(impact.evaluatedAt)) throw new Error("Invalid impact observation binding");
  const observed = Date.parse(event.observedAt), ttl = event.kind === "rail-operation" ? 300000 : 3600000;
  // Weather chunks have independent coverage; one chunk cannot resolve another chunk's episode.
  const subjectKey = monitoringKey([watchSubjectKey(event.subject), event.kind === "weather" && event.fact.status === "observed" ? event.fact.requestedRange : null]);
  const observation: ImpactNotificationObservation = { tripId: impact.tripId, tripRevision: impact.tripRevision, impactId: impact.id, subjectKey,
    kind: event.kind, observedAt: event.observedAt, evaluatedAt: impact.evaluatedAt, fresh: event.freshness === "fresh" && event.fact.status === "observed",
    expiresAt: new Date(Math.min(observed + ttl, ...event.sources.flatMap((s) => s.validUntil ? [Date.parse(s.validUntil)] : []))).toISOString() };
  const sk = signalKey(impact.tripId, subjectKey);
  return { Update: { TableName: table, Key: { pk: { S: `OWNER#${principal.subject}` }, sk: { S: sk } },
    UpdateExpression: "SET storageVersion = :one, workKind = :kind, observation = :observation, sourceTripRevision = :revision, observationOrder = :order, workVersion = if_not_exists(workVersion, :zero) + :one, attempts = :zero, workState = :pending, workShard = :shard, availableAt = :now",
    ConditionExpression: "attribute_not_exists(pk) OR sourceTripRevision < :revision OR (sourceTripRevision = :revision AND observationOrder <= :order)",
    ExpressionAttributeValues: { ":one": { N: "1" }, ":zero": { N: "0" }, ":kind": { S: "signal" }, ":observation": { S: JSON.stringify(observation) },
      ":revision": { N: String(impact.tripRevision) }, ":order": { S: observationOrder(observation) }, ":pending": { S: "pending" }, ":shard": { S: notificationShard(sk) }, ":now": { N: String(Date.parse(impact.evaluatedAt)) } } } };
}
