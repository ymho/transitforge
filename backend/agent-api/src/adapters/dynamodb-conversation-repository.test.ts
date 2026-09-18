import { describe, expect, it } from "vitest";
import { stateDynamoFixture, stateA as a, stateB as b, conversationId as id, secondId, stateMetadata } from "./state-dynamodb.fixture.js";
import { DynamoDbConversationRepository } from "./dynamodb-conversation-repository.js";

const message = { role: "user" as const, text: "日程を相談したい" };
describe("Conversation persistence", () => {
  it("round trips metadata and bounded ordered messages separately", async () => {
    const f = stateDynamoFixture(), input = stateMetadata();
    const created = await f.conversations.create(a, id, input);
    input.title = "書き換え";
    expect(await f.conversations.get(a, id)).toEqual(created);
    const next = await f.conversations.append(a, id, 0, [message, { role: "assistant", text: "いつ出発しますか" }]);
    expect(next).toMatchObject({ revision: 1, messageCount: 2, ownerSubject: a.subject });
    const first = await f.conversations.history(a, id, { limit: 1 });
    expect(first.items).toEqual([{ ...message, sequence: 1, createdAt: f.clock.now().toISOString() }]);
    expect((await f.conversations.history(a, id, { after: first.nextAfter })).items[0].sequence).toBe(2);
    expect(f.records.size).toBe(3);
    const { tripId: _trip, ...metadata } = stateMetadata();
    expect(await f.conversations.update(a, id, 1, metadata)).not.toHaveProperty("tripId");
  });
  it("isolates get/list/history/update/append/delete even for equal IDs", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata());
    expect(await f.conversations.get(b, id)).toBeUndefined();
    expect((await f.conversations.list(b)).items).toEqual([]);
    for (const target of [id, secondId]) {
      await expect(f.conversations.history(b, target)).rejects.toMatchObject({ code: "not-found" });
      await expect(f.conversations.append(b, target, 0, [message])).rejects.toMatchObject({ code: "not-found" });
      await expect(f.conversations.update(b, target, 0, stateMetadata())).rejects.toMatchObject({ code: "not-found" });
      await expect(f.conversations.delete(b, target, 0)).rejects.toMatchObject({ code: "not-found" });
    }
    await f.conversations.create(b, id, { ...stateMetadata(), title: "B" });
    await f.conversations.delete(b, id, 0);
    expect((await f.conversations.get(a, id))?.title).toBe("会話");
  });
  it("uses owner-derived pagination and continues across tombstones", async () => {
    const f = stateDynamoFixture();
    await f.conversations.create(a, id, stateMetadata()); await f.conversations.create(a, secondId, stateMetadata());
    await f.conversations.delete(a, id, 0);
    const first = await f.conversations.list(a, { limit: 1 });
    expect(first).toEqual({ items: [], nextAfter: id });
    expect((await f.conversations.list(a, { after: first.nextAfter })).items[0].conversationId).toBe(secondId);
    expect((await f.conversations.list(b, { after: first.nextAfter })).items).toEqual([]);
    await expect(f.conversations.list(b, { after: `OWNER#${a.subject}` })).rejects.toMatchObject({ code: "invalid-input" });
  });
  it("CAS prevents partial or duplicate appends under contention and lost responses", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata());
    f.faults.beforeWrite = async () => { await f.conversations.append(a, id, 0, [message]); };
    await expect(f.conversations.append(a, id, 0, [{ ...message, text: "負けた書込み" }])).rejects.toMatchObject({ code: "conflict" });
    expect((await f.conversations.history(a, id)).items.map((v) => v.text)).toEqual([message.text]);
    f.faults.lostResponse = true;
    await expect(f.conversations.append(a, id, 1, [message])).rejects.toMatchObject({ code: "unavailable" });
    await expect(f.conversations.append(a, id, 1, [message])).rejects.toMatchObject({ code: "conflict" });
    expect((await f.conversations.get(a, id))?.messageCount).toBe(2);
  });
  it("delete fences a concurrent append and strips metadata before resumable cleanup", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata());
    f.faults.beforeWrite = async () => { await f.conversations.delete(a, id, 0); };
    await expect(f.conversations.append(a, id, 0, [message])).rejects.toMatchObject({ code: "not-found" });
    expect(f.records.size).toBe(1);
    expect([...f.records.values()][0]).not.toHaveProperty("payload");
    await expect(f.conversations.create(a, id, stateMetadata())).rejects.toMatchObject({ code: "conflict" });
  });
  it("rejects a delete racing with an update without removing history", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata());
    f.faults.beforeWrite = async () => { await f.conversations.append(a, id, 0, [message]); };
    await expect(f.conversations.delete(a, id, 0)).rejects.toMatchObject({ code: "conflict" });
    expect((await f.conversations.history(a, id)).items).toHaveLength(1);
  });
  it("metadata edits use the same revision fence as appends", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata());
    f.faults.beforeWrite = async () => { await f.conversations.update(a, id, 0, { ...stateMetadata(), title: "採用済み" }); };
    await expect(f.conversations.update(a, id, 0, { ...stateMetadata(), title: "古い編集" })).rejects.toMatchObject({ code: "conflict" });
    expect((await f.conversations.get(a, id))?.title).toBe("採用済み");
  });
  it("honors DynamoDB byte page boundaries and restores history from a fresh repository", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata());
    // Escaped control characters enlarge the stored JSON while staying within UTF-8 text limits.
    await f.conversations.append(a, id, 0, Array.from({ length: 20 }, () => ({ ...message, text: "\u0000".repeat(16 * 1024) })));
    const restored = new DynamoDbConversationRepository("test-state", f.client, f.clock);
    const first = await restored.history(a, id, { limit: 50 });
    expect(first.items.length).toBeGreaterThan(0); expect(first.items.length).toBeLessThan(20);
    expect(first.nextAfter).toBeDefined();
    const messages = [...first.items];
    let after = first.nextAfter;
    while (after) {
      const page = await restored.history(a, id, { limit: 50, after });
      messages.push(...page.items); after = page.nextAfter;
    }
    expect(messages.map((v) => v.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
  it("keeps large histories outside the metadata item and paginates deletion with retries", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata());
    for (let version = 0; version < 3; version++) await f.conversations.append(a, id, version, Array.from({ length: 20 }, () => ({ ...message, text: "x".repeat(16 * 1024) })));
    expect((await f.conversations.history(a, id, { limit: 50 })).items).toHaveLength(50);
    f.faults.failPurge = true;
    await expect(f.conversations.delete(a, id, 3)).rejects.toMatchObject({ code: "unavailable" });
    expect(await f.conversations.get(a, id)).toBeUndefined();
    await expect(f.conversations.history(a, id)).rejects.toMatchObject({ code: "not-found" });
    expect(await f.conversations.delete(a, id, 3)).toEqual({ complete: false });
    expect(await f.conversations.delete(a, id, 3)).toEqual({ complete: true });
    expect(await f.conversations.delete(a, id, 3)).toEqual({ complete: true });
    expect(f.records.size).toBe(1);
    expect(JSON.stringify([...f.records.values()])).not.toContain("相談");
  });
  it("does not return history if deleted during the read", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata()); await f.conversations.append(a, id, 0, [message]);
    f.faults.afterQuery = async () => { await f.conversations.delete(a, id, 1); };
    await expect(f.conversations.history(a, id)).rejects.toMatchObject({ code: "not-found" });
  });
  it("rejects invalid input, forged authority, oversized UTF-8, and missing principals before SDK calls", async () => {
    const f = stateDynamoFixture();
    await expect(f.conversations.create(a, id, { ...stateMetadata(), ownerId: b.subject } as never)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.conversations.create(a, id, { ...stateMetadata(), scope: ["trip"] } as never)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.conversations.append(a, id, 0, [{ ...message, role: ["user"] }] as never)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.conversations.append(a, id, 0, [{ ...message, text: "あ".repeat(6000) }])).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.conversations.append(a, id, 0, Array.from({ length: 21 }, () => message))).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.conversations.list(a, { limit: 51 })).rejects.toMatchObject({ code: "invalid-input" });
    const missing = undefined as never;
    for (const call of [() => f.conversations.get(missing, id), () => f.conversations.list(missing), () => f.conversations.history(missing, id),
      () => f.conversations.create(missing, id, stateMetadata()), () => f.conversations.append(missing, id, 0, [message]),
      () => f.conversations.update(missing, id, 0, stateMetadata()), () => f.conversations.delete(missing, id, 0)]) {
      await expect(call()).rejects.toMatchObject({ code: "unauthenticated" });
    }
    expect(f.commands).toHaveLength(0);
  });
  it("hides SDK/private corruption details", async () => {
    const repository = new DynamoDbConversationRepository("test-state", { send: async () => { throw new Error("secret-token-profile"); } });
    const error = await repository.get(a, id).catch((error: unknown) => error);
    expect(error).toMatchObject({ message: "unavailable" });
    expect(error).not.toHaveProperty("cause");
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata());
    [...f.records.values()][0].pk = { S: `OWNER#${b.subject}` };
    await expect(f.conversations.get(a, id)).rejects.toMatchObject({ code: "unavailable" });
  });
  it("fails closed on corrupt message payloads and foreign query cursors", async () => {
    const f = stateDynamoFixture(); await f.conversations.create(a, id, stateMetadata()); await f.conversations.append(a, id, 0, [message]);
    const stored = [...f.records.values()].find((v) => v.sk.S?.startsWith("MESSAGE#"))!;
    stored.payload = { S: "not-json-private-content" };
    await expect(f.conversations.history(a, id)).rejects.toMatchObject({ code: "unavailable" });
    const repository = new DynamoDbConversationRepository("test-state", { send: async () => ({ Items: [], LastEvaluatedKey: { pk: { S: `OWNER#${b.subject}` }, sk: { S: `CONVERSATION#${id}` } } }) });
    await expect(repository.list(a)).rejects.toMatchObject({ code: "unavailable" });
  });
});
