import { DynamoDBClient, GetItemCommand, PutItemCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { createItineraryCandidateSet, type ItineraryCandidateSet } from "@raiquora/trip/itinerary-candidates";
import { conversationIdentifier, TripResourceError, tripIdentifier, validateMutation } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal } from "../ports/trip-repository.js";
import type { CandidateAdoptionPreviewReceipt, CandidateAdoptionReceiptRepository, ItineraryCandidateRepository } from "../ports/itinerary-candidate-repository.js";

const maximumCandidateBytes = 180_000;
type Result = { Item?: Record<string, AttributeValue> };
export interface CandidateDynamoClient { send(command: GetItemCommand | PutItemCommand): Promise<Result> }

/** Candidate sets are immutable, bounded read models. They are not a second editable Trip source. */
export class DynamoDbItineraryCandidateRepository implements ItineraryCandidateRepository, CandidateAdoptionReceiptRepository {
  constructor(private readonly table: string, private readonly client: CandidateDynamoClient = new DynamoDBClient({})) {
    if (!table) throw new TripResourceError("unavailable");
  }
  async put(principal: TripPrincipal, input: ItineraryCandidateSet): Promise<void> {
    const candidateSet = boundedCandidateSet(input), key = this.key(principal, candidateSet.contextRef.conversationId, candidateSet.id, candidateSet.revision);
    try {
      await this.client.send(new PutItemCommand({ TableName: this.table, Item: { ...key, storageVersion: { N: "1" }, candidateSet: { S: JSON.stringify(candidateSet) }, expiresAtIso: { S: candidateSet.expiresAt } },
        ConditionExpression: "attribute_not_exists(pk)" }));
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        const existing = await this.get(principal, candidateSet.contextRef.conversationId, candidateSet.id, candidateSet.revision);
        if (existing && JSON.stringify(existing) === JSON.stringify(candidateSet)) return;
        throw new TripResourceError("conflict");
      }
      throw new TripResourceError("unavailable");
    }
  }
  async get(principal: TripPrincipal, conversationId: string, candidateSetId: string, revision: number): Promise<ItineraryCandidateSet | undefined> {
    const key = this.key(principal, conversationId, candidateSetId, revision);
    let result: Result;
    try { result = await this.client.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true })); }
    catch { throw new TripResourceError("unavailable"); }
    if (!result.Item) return undefined;
    try {
      const item = result.Item;
      if (item.pk?.S !== key.pk.S || item.sk?.S !== key.sk.S || item.storageVersion?.N !== "1" || typeof item.candidateSet?.S !== "string") throw new Error();
      const candidateSet = boundedCandidateSet(JSON.parse(item.candidateSet.S));
      if (candidateSet.contextRef.conversationId !== conversationId || candidateSet.id !== candidateSetId || candidateSet.revision !== revision || item.expiresAtIso?.S !== candidateSet.expiresAt) throw new Error();
      return candidateSet;
    } catch { throw new TripResourceError("unavailable"); }
  }
  async putPreview(principal: TripPrincipal, value: CandidateAdoptionPreviewReceipt): Promise<CandidateAdoptionPreviewReceipt> {
    const receipt = boundedPreview(value), key = this.previewKey(principal, receipt.mutationId), encoded = JSON.stringify(receipt);
    try {
      await this.client.send(new PutItemCommand({ TableName: this.table, Item: { ...key, storageVersion: { N: "1" }, preview: { S: encoded } }, ConditionExpression: "attribute_not_exists(pk)" }));
      return structuredClone(receipt);
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        const existing = await this.getPreview(principal, receipt.mutationId);
        if (existing && JSON.stringify(existing) === encoded) return existing;
        throw new TripResourceError("mutation-reused");
      }
      throw new TripResourceError("unavailable");
    }
  }
  async getPreview(principal: TripPrincipal, mutationId: string): Promise<CandidateAdoptionPreviewReceipt | undefined> {
    const key = this.previewKey(principal, mutationId); let result: Result;
    try { result = await this.client.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true })); }
    catch { throw new TripResourceError("unavailable"); }
    if (!result.Item) return undefined;
    try {
      if (result.Item.pk?.S !== key.pk.S || result.Item.sk?.S !== key.sk.S || result.Item.storageVersion?.N !== "1" || typeof result.Item.preview?.S !== "string") throw new Error();
      return boundedPreview(JSON.parse(result.Item.preview.S));
    } catch (error) { if (error instanceof TripResourceError) throw error; throw new TripResourceError("unavailable"); }
  }
  private key(principal: TripPrincipal, conversationId: string, candidateSetId: string, revision: number) {
    requireTripPrincipal(principal); conversationIdentifier(conversationId); stableId(candidateSetId);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new TripResourceError("invalid-input");
    return { pk: { S: `OWNER#${principal.subject}` }, sk: { S: `CANDIDATE#${conversationId}#${candidateSetId}#${revision}` } };
  }
  private previewKey(principal: TripPrincipal, mutationId: string) {
    requireTripPrincipal(principal); tripIdentifier(mutationId);
    return { pk: { S: `OWNER#${principal.subject}` }, sk: { S: `CANDIDATE_ADOPTION#${mutationId}` } };
  }
}

function boundedCandidateSet(value: ItineraryCandidateSet): ItineraryCandidateSet {
  try {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, "utf8") > maximumCandidateBytes) throw new TripResourceError("payload-too-large");
    return createItineraryCandidateSet(JSON.parse(encoded));
  } catch (error) {
    if (error instanceof TripResourceError) throw error;
    throw new TripResourceError("invalid-input");
  }
}
function stableId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(value)) throw new TripResourceError("invalid-input");
}
function boundedPreview(value: CandidateAdoptionPreviewReceipt): CandidateAdoptionPreviewReceipt {
  try {
    if (!value || typeof value !== "object" || Object.keys(value).some((key) => !["mutationId", "conversationId", "candidateSetId", "candidateSetRevision", "variantId", "tripId", "baseTripRevision", "confirmationKey", "proposal", "componentMap"].includes(key))) throw new Error();
    tripIdentifier(value.mutationId); tripIdentifier(value.tripId); conversationIdentifier(value.conversationId); stableId(value.candidateSetId); stableId(value.variantId);
    if (![value.candidateSetRevision, value.baseTripRevision].every((item) => Number.isSafeInteger(item) && item >= 0) || !/^[0-9a-f]{64}$/u.test(value.confirmationKey) || !Array.isArray(value.componentMap)) throw new Error();
    const components = new Set<string>(), items = new Set<string>();
    for (const mapping of value.componentMap) {
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping) || Object.keys(mapping).some((key) => !["componentId", "itemId"].includes(key))) throw new Error();
      stableId(mapping.componentId);
      if (typeof mapping.itemId !== "string" || !mapping.itemId.trim() || mapping.itemId.length > 200 || /[\u0000-\u001f\u007f]/u.test(mapping.itemId) || components.has(mapping.componentId) || items.has(mapping.itemId)) throw new Error();
      components.add(mapping.componentId); items.add(mapping.itemId);
    }
    validateMutation({ tripId: value.tripId, baseRevision: value.baseTripRevision, mutationId: value.mutationId, proposal: value.proposal });
    const encoded = JSON.stringify(value); if (Buffer.byteLength(encoded, "utf8") > maximumCandidateBytes) throw new TripResourceError("payload-too-large");
    return structuredClone(value);
  } catch (error) { if (error instanceof TripResourceError) throw error; throw new TripResourceError("invalid-input"); }
}
