import { createHash } from "node:crypto";
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { createTrip, type Trip } from "@raiquora/trip/trip";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import { requireTripPrincipal, type TripPrincipal } from "../contracts/trip-principal.js";
import { TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import { metadata, type Conversation } from "../contracts/server-state.js";
import type { TripConsultationRepository } from "../ports/trip-consultation-repository.js";
import { DynamoDbTripRepository, type TripDynamoClient } from "./dynamodb-trip-repository.js";
import { tripChangedPut } from "./trip-changed-record.js";

/** Cross-table atomic start under the existing Trip writer's IAM. No compensating
 * archive/delete: a lost response is resolved from the durable start receipt. */
export class DynamoDbTripConsultationRepository implements TripConsultationRepository {
  private readonly trips: DynamoDbTripRepository;
  constructor(private readonly tripTable: string, private readonly stateTable: string,
    private readonly client: TripDynamoClient = new DynamoDBClient({}),
    private readonly clock: TripClock = { now: () => new Date() }) {
    if (!tripTable || !stateTable || tripTable === stateTable) throw new TripResourceError("unavailable");
    this.trips = new DynamoDbTripRepository(tripTable, client, clock);
  }
  async start(principal: TripPrincipal, input: { tripId: string; title: string }): Promise<{ trip: Trip; conversationId: string }> {
    requireTripPrincipal(principal); tripIdentifier(input.tripId);
    if (input.tripId !== input.tripId.toLowerCase()) throw new TripResourceError("invalid-input");
    if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160) throw new TripResourceError("invalid-input");
    // Snapshot before awaiting so callers cannot switch the owner/request midway.
    principal = { subject: principal.subject };
    const tripId = input.tripId, title = input.title.trim(), owner = `OWNER#${principal.subject}`;
    const key = (sk: string) => ({ pk: { S: owner }, sk: { S: sk } });
    const receiptKey = key(`CONSULTATION_START#${tripId}`), conversationKey = key(`TRIP_CONVERSATION#${tripId}`);
    const digest = createHash("sha256").update(JSON.stringify(["trip-consultation-start-v1", tripId, title])).digest("hex");
    const read = async (table: string, Key: Record<string, AttributeValue>) => {
      try { return (await this.client.send(new GetItemCommand({ TableName: table, Key, ConsistentRead: true }))).Item; }
      catch { throw new TripResourceError("unavailable"); }
    };
    const completed = async (): Promise<{ trip: Trip; conversationId: string } | undefined> => {
      const receipt = await read(this.tripTable, receiptKey);
      if (!receipt) return undefined;
      if (receipt.pk?.S !== owner || receipt.sk?.S !== receiptKey.sk.S || receipt.storageVersion?.N !== "1") throw new TripResourceError("unavailable");
      if (receipt.digest?.S !== digest) throw new TripResourceError("mutation-reused");
      const trip = await this.trips.get(principal, tripId), saved = await read(this.stateTable, conversationKey);
      if (!trip || !saved || saved.deleted?.BOOL === true) throw new TripResourceError("not-found");
      try {
        const value = JSON.parse(saved.payload?.S ?? "") as Conversation;
        const { conversationId, ownerSubject, createdAt, updatedAt, revision, messageCount, ...fields } = value;
        metadata(fields);
        if (saved.pk?.S !== owner || saved.sk?.S !== conversationKey.sk.S || saved.storageVersion?.N !== "1" || saved.deleted?.BOOL !== false ||
            ownerSubject !== principal.subject || conversationId !== tripId || value.tripId !== tripId || String(revision) !== saved.revision?.N ||
            !Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(messageCount) || messageCount < 0 || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw new Error();
      } catch { throw new TripResourceError("unavailable"); }
      return { trip, conversationId: tripId };
    };
    const replay = await completed(); if (replay) return replay;
    const now = this.clock.now().toISOString(), trip = createTrip(tripId, title, now);
    const conversation: Conversation = { conversationId: tripId, tripId, scope: "trip", title,
      ownerSubject: principal.subject, summary: "", resolvedTopics: [], pendingTopics: [],
      createdAt: now, updatedAt: now, revision: 0, messageCount: 0 };
    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
        { Put: { TableName: this.tripTable, Item: { ...key(`TRIP#${tripId}`), storageVersion: { N: "1" }, revision: { N: "0" }, archived: { BOOL: false }, trip: { S: JSON.stringify(trip) } }, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: this.stateTable, Item: { ...conversationKey, storageVersion: { N: "1" }, revision: { N: "0" }, deleted: { BOOL: false }, payload: { S: JSON.stringify(conversation) } }, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: this.tripTable, Item: { ...receiptKey, storageVersion: { N: "1" }, digest: { S: digest } }, ConditionExpression: "attribute_not_exists(pk)" } },
        tripChangedPut(this.tripTable, owner, tripId, 0, "created", now),
      ] }));
    } catch (error) {
      const recovered = await completed(); if (recovered) return recovered;
      const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> })?.CancellationReasons;
      if (reasons?.some(({ Code }) => Code === "ConditionalCheckFailed")) throw new TripResourceError("already-exists");
      throw new TripResourceError("unavailable");
    }
    return { trip, conversationId: tripId };
  }
}
