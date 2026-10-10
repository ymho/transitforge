import { createHash } from "node:crypto";
import { DynamoDBClient, GetItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { createTrip, type Trip } from "@raiquora/trip/trip";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import { requireTripPrincipal, type TripPrincipal } from "../contracts/trip-principal.js";
import { boundedTrip, TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
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

  async branch(principal: TripPrincipal, input: { sourceTripId: string; sourceRevision: number; tripId: string; title: string }) {
    requireTripPrincipal(principal); tripIdentifier(input.sourceTripId); tripIdentifier(input.tripId);
    if (input.sourceTripId === input.tripId || input.tripId !== input.tripId.toLowerCase() || !Number.isSafeInteger(input.sourceRevision) || input.sourceRevision < 0 ||
        typeof input.title !== "string" || !input.title.trim() || input.title.length > 160) throw new TripResourceError("invalid-input");
    principal = { subject: principal.subject };
    const owner = `OWNER#${principal.subject}`, title = input.title.trim();
    const key = (sk: string) => ({ pk: { S: owner }, sk: { S: sk } });
    const sourceTripKey = key(`TRIP#${input.sourceTripId}`), sourceConversationKey = key(`TRIP_CONVERSATION#${input.sourceTripId}`);
    const tripKey = key(`TRIP#${input.tripId}`), conversationKey = key(`TRIP_CONVERSATION#${input.tripId}`), receiptKey = key(`CONSULTATION_BRANCH#${input.tripId}`);
    const digest = createHash("sha256").update(JSON.stringify(["trip-consultation-branch-v1", input.sourceTripId, input.sourceRevision, input.tripId, title])).digest("hex");
    const read = async (table: string, Key: Record<string, AttributeValue>) => {
      try { return (await this.client.send(new GetItemCommand({ TableName: table, Key, ConsistentRead: true }))).Item; }
      catch { throw new TripResourceError("unavailable"); }
    };
    const completed = async () => {
      const receipt = await read(this.tripTable, receiptKey);
      if (!receipt) return undefined;
      if (receipt.pk?.S !== owner || receipt.sk?.S !== receiptKey.sk.S || receipt.storageVersion?.N !== "1") throw new TripResourceError("unavailable");
      if (receipt.digest?.S !== digest) throw new TripResourceError("mutation-reused");
      const trip = await this.trips.get(principal, input.tripId), conversation = await read(this.stateTable, conversationKey);
      if (!trip || !conversation || conversation.deleted?.BOOL !== false) throw new TripResourceError("not-found");
      return { trip, conversationId: input.tripId, sourceTripId: input.sourceTripId };
    };
    const replay = await completed(); if (replay) return replay;
    const source = await this.trips.get(principal, input.sourceTripId);
    if (!source) throw new TripResourceError("not-found");
    if (source.revision !== input.sourceRevision) throw new TripResourceError("conflict");
    const sourceConversation = await read(this.stateTable, sourceConversationKey);
    if (!sourceConversation || sourceConversation.deleted?.BOOL !== false || sourceConversation.storageVersion?.N !== "1") throw new TripResourceError("not-found");
    let conversation: Conversation;
    try {
      const value = JSON.parse(sourceConversation.payload?.S ?? "") as Conversation;
      const { conversationId, ownerSubject, createdAt, updatedAt, revision, messageCount, ...fields } = value;
      metadata(fields);
      if (conversationId !== input.sourceTripId || value.tripId !== input.sourceTripId || ownerSubject !== principal.subject ||
          sourceConversation.revision?.N !== String(revision) || !Number.isSafeInteger(messageCount) || messageCount < 0 ||
          !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt)) || Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error();
      if (messageCount > 94) throw new TripResourceError("payload-too-large");
      const now = this.clock.now().toISOString();
      conversation = { ...fields, conversationId: input.tripId, tripId: input.tripId, title, ownerSubject: principal.subject,
        createdAt: now, updatedAt: now, revision: 0, messageCount };
    } catch (error) { if (error instanceof TripResourceError) throw error; throw new TripResourceError("unavailable"); }
    let messageRows: Record<string, AttributeValue>[];
    try {
      const result = await this.client.send(new QueryCommand({ TableName: this.stateTable,
        KeyConditionExpression: "pk = :owner AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":owner": { S: owner }, ":prefix": { S: `TRIP_MESSAGE#${input.sourceTripId}#` } },
        Limit: 95, ConsistentRead: true }));
      messageRows = result.Items ?? [];
      if (result.LastEvaluatedKey || messageRows.length !== conversation.messageCount) throw new TripResourceError("payload-too-large");
    } catch (error) { if (error instanceof TripResourceError) throw error; throw new TripResourceError("unavailable"); }
    const copiedMessages = messageRows.map((row, index) => {
      try {
        const value = JSON.parse(row.payload?.S ?? "") as Record<string, unknown>;
        const delivery = value.delivery as Record<string, unknown> | undefined;
        if (row.storageVersion?.N !== "1" || value.sequence !== index + 1 || !["user", "assistant"].includes(String(value.role)) || typeof value.text !== "string" ||
            typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || delivery !== undefined &&
            (!delivery || typeof delivery !== "object" || Array.isArray(delivery) || Object.keys(delivery).some(key => !["status", "basis"].includes(key)) ||
              !["full", "partial", "degraded"].includes(String(delivery.status)) || !["model", "verified_projection"].includes(String(delivery.basis)))) throw new Error();
        // Copy visible history only. Old proposals/receipts remain historical text and cannot be executed in the branch.
        const payload = { sequence: value.sequence, createdAt: value.createdAt, role: value.role, text: value.text,
          ...(value.delivery === undefined ? {} : { delivery: value.delivery }) };
        return { Put: { TableName: this.stateTable, Item: { ...key(`TRIP_MESSAGE#${input.tripId}#${String(index + 1).padStart(12, "0")}`),
          storageVersion: { N: "1" }, payload: { S: JSON.stringify(payload) } }, ConditionExpression: "attribute_not_exists(pk)" } };
      } catch { throw new TripResourceError("unavailable"); }
    });
    const now = this.clock.now().toISOString();
    const costs = source.costs ? { ...structuredClone(source.costs), ...(source.costs.forecast ? { forecast: { ...structuredClone(source.costs.forecast), tripId: input.tripId, baseRevision: 0 } } : {}), stale: true } : undefined;
    const adoption = source.adoption ? { ...source.adoption, needsReconfirmation: true as const } : undefined;
    const trip = boundedTrip({ ...structuredClone(source), id: input.tripId, title, revision: 0, createdAt: now, updatedAt: now,
      items: source.items.map(({ bookingStatus: _bookingStatus, ...item }) => item.decision ? { ...item, decision: { ...item.decision, needsReconfirmation: true } } : item),
      lifecycleState: "pre_trip", ...(costs ? { costs } : {}), ...(adoption ? { adoption } : {}) });
    try {
      await this.client.send(new TransactWriteItemsCommand({ TransactItems: [
        { ConditionCheck: { TableName: this.tripTable, Key: sourceTripKey, ConditionExpression: "attribute_exists(pk) AND archived = :active AND revision = :revision",
          ExpressionAttributeValues: { ":active": { BOOL: false }, ":revision": { N: String(input.sourceRevision) } } } },
        { ConditionCheck: { TableName: this.stateTable, Key: sourceConversationKey, ConditionExpression: "attribute_exists(pk) AND deleted = :deleted AND revision = :revision",
          ExpressionAttributeValues: { ":deleted": { BOOL: false }, ":revision": sourceConversation.revision! } } },
        { Put: { TableName: this.tripTable, Item: { ...tripKey, storageVersion: { N: "1" }, revision: { N: "0" }, archived: { BOOL: false }, trip: { S: JSON.stringify(trip) } }, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: this.stateTable, Item: { ...conversationKey, storageVersion: { N: "1" }, revision: { N: "0" }, deleted: { BOOL: false }, payload: { S: JSON.stringify(conversation) } }, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: this.tripTable, Item: { ...receiptKey, storageVersion: { N: "1" }, digest: { S: digest } }, ConditionExpression: "attribute_not_exists(pk)" } },
        tripChangedPut(this.tripTable, owner, input.tripId, 0, "created", now), ...copiedMessages,
      ] }));
    } catch (error) {
      const recovered = await completed(); if (recovered) return recovered;
      const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> })?.CancellationReasons;
      if (reasons?.[0]?.Code === "ConditionalCheckFailed" || reasons?.[1]?.Code === "ConditionalCheckFailed") throw new TripResourceError("conflict");
      if (reasons?.some(({ Code }, index) => index >= 2 && Code === "ConditionalCheckFailed")) throw new TripResourceError("already-exists");
      throw new TripResourceError("unavailable");
    }
    return { trip, conversationId: input.tripId, sourceTripId: input.sourceTripId };
  }
}
