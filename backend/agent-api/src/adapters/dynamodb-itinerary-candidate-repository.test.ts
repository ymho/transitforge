import { describe, expect, it } from "vitest";
import { GetItemCommand, PutItemCommand, QueryCommand, TransactWriteItemsCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { createItineraryCandidateSet } from "@raiquora/trip/itinerary-candidates";
import { DynamoDbItineraryCandidateRepository, type CandidateDynamoClient } from "./dynamodb-itinerary-candidate-repository.js";

const owner = { subject: "owner-a" }, other = { subject: "owner-b" };
const conversationId = "conversation-1", tripId = "11111111-1111-4111-8111-111111111111", mutationId = "22222222-2222-4222-8222-222222222222";
const set = createItineraryCandidateSet({ id: "set-1", revision: 0,
  contextRef: { conversationId, requestFingerprint: "fingerprint", tripId, baseTripRevision: 0 },
  variants: [{ id: "variant-1", label: "案", timeline: { dayOrder: ["day-1"], itemOrder: ["component-1"] },
    items: [{ componentId: "component-1", kind: "activity", title: "散策", schedule: { type: "unscheduled" }, evidenceRefs: [], placement: { atBeginning: true } }],
    assumptionRefs: [], assessmentRefs: [], changedComponentIds: ["component-1"], removedBaseItemIds: [], retainedBaseItemIds: [] }],
  coverage: { coveredScopes: ["day-1"], omittedScopes: [], complete: true }, issuedAt: "2026-09-23T00:00:00Z", expiresAt: "2026-09-24T00:00:00Z" });
const preview = { mutationId, conversationId, candidateSetId: set.id, candidateSetRevision: 0, variantId: "variant-1", tripId, baseTripRevision: 0,
  confirmationKey: "a".repeat(64), proposal: { tripId, baseRevision: 0, summary: "案", patches: [] }, componentMap: [] };

function fixture() {
  const records = new Map<string, Record<string, AttributeValue>>(), commands: unknown[] = [];
  let failDelete = false;
  const key = (item: Record<string, AttributeValue>) => `${item.pk!.S}/${item.sk!.S}`;
  const client: CandidateDynamoClient = { async send(command) {
    commands.push(command);
    if (command instanceof GetItemCommand) {
      const item = records.get(key(command.input.Key!)); return item ? { Item: structuredClone(item) } : {};
    }
    if (command instanceof PutItemCommand) {
      const k = key(command.input.Item!);
      if (records.has(k)) throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
      records.set(k, structuredClone(command.input.Item!)); return {};
    }
    if (command instanceof QueryCommand) {
      expect(command.input.ConsistentRead).toBe(true); expect(command.input.Limit).toBe(50);
      const values = command.input.ExpressionAttributeValues!, ownerKey = values[":owner"]!.S!, prefix = values[":prefix"]!.S!;
      const all = [...records.values()].filter((item) => item.pk!.S === ownerKey && item.sk!.S!.startsWith(prefix)).sort((a, b) => a.sk!.S!.localeCompare(b.sk!.S!));
      const items = all.slice(0, 50).map((item) => ({ pk: item.pk!, sk: item.sk! }));
      return { Items: structuredClone(items), ...(all.length > 50 ? { LastEvaluatedKey: structuredClone(items.at(-1)) } : {}) };
    }
    if (command instanceof TransactWriteItemsCommand) {
      if (failDelete) { failDelete = false; throw new Error("private delete failure"); }
      for (const action of command.input.TransactItems ?? []) records.delete(key(action.Delete!.Key!));
      return {};
    }
    throw new Error("unexpected command");
  } };
  return { records, commands, repository: new DynamoDbItineraryCandidateRepository("trips", client), failOnce: () => { failDelete = true; } };
}

describe("owner-scoped retained candidate resources", () => {
  it("binds candidate/adoption reads to owner+conversation and purges only that conversation", async () => {
    const f = fixture();
    await f.repository.put(owner, set); await f.repository.putPreview(owner, preview);
    await f.repository.put(other, set); await f.repository.putPreview(other, preview);
    f.records.set(`OWNER#${owner.subject}/TRIP#${tripId}`, { pk: { S: `OWNER#${owner.subject}` }, sk: { S: `TRIP#${tripId}` } });
    f.records.set(`OWNER#${owner.subject}/RESERVATION#${tripId}`, { pk: { S: `OWNER#${owner.subject}` }, sk: { S: `RESERVATION#${tripId}` } });
    expect(await f.repository.get(owner, conversationId, set.id, 0)).toEqual(set);
    expect(await f.repository.get(other, conversationId, set.id, 0)).toEqual(set);
    expect(await f.repository.getPreview(owner, conversationId, mutationId)).toEqual(preview);
    expect(await f.repository.getPreview(owner, "another-conversation", mutationId)).toBeUndefined();
    expect(await f.repository.purgeConversation(owner, conversationId)).toEqual({ complete: true });
    expect(await f.repository.get(owner, conversationId, set.id, 0)).toBeUndefined();
    expect(await f.repository.getPreview(owner, conversationId, mutationId)).toBeUndefined();
    expect(await f.repository.get(other, conversationId, set.id, 0)).toEqual(set);
    expect([...f.records.keys()].filter((key) => key.startsWith(`OWNER#${owner.subject}/`))).toEqual([
      `OWNER#${owner.subject}/TRIP#${tripId}`, `OWNER#${owner.subject}/RESERVATION#${tripId}`,
    ]);
  });

  it("retries a failed or multi-page purge without scanning or deleting unrelated records", async () => {
    const f = fixture();
    for (let index = 0; index < 51; index++) f.records.set(`OWNER#${owner.subject}/CANDIDATE#${conversationId}#set-${String(index).padStart(2, "0")}#0`, {
      pk: { S: `OWNER#${owner.subject}` }, sk: { S: `CANDIDATE#${conversationId}#set-${String(index).padStart(2, "0")}#0` },
    });
    f.failOnce(); await expect(f.repository.purgeConversation(owner, conversationId)).rejects.toMatchObject({ code: "unavailable" });
    expect(await f.repository.purgeConversation(owner, conversationId)).toEqual({ complete: false });
    expect(await f.repository.purgeConversation(owner, conversationId)).toEqual({ complete: true });
    expect([...f.records.keys()].some((key) => key.includes(`CANDIDATE#${conversationId}#`))).toBe(false);
    expect(f.commands.some((command) => command instanceof QueryCommand)).toBe(true);
  });
});
