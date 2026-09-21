import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import type { ServerConversation, ServerConversationMetadata } from "../personal-state/server-conversation-client";
import { createConversationDraftTrip } from "./create-conversation-draft-trip";
const tripId = "11111111-1111-4111-8111-111111111111", conversationId = "22222222-2222-4222-8222-222222222222", now = "2026-09-19T00:00:00Z";
function fixture() {
  const request = { goal: "温泉でのんびり", constraints: [], assumptions: [] };
  let metadata: ServerConversation = { conversationId, title: "相談", scope: "general", summary: "", resolvedTopics: [], pendingTopics: [], revision: 3, messageCount: 0, createdAt: now, updatedAt: now, draftRequest: request };
  const saved = createTrip(tripId, "新しい旅程", now, [], request);
  const client = { create: vi.fn(async () => saved), get: vi.fn(async () => saved), sessionVersion: () => 0 };
  const conversations = { get: vi.fn(async () => metadata), update: vi.fn(async (_id: string, revision: number, next: ServerConversationMetadata) => {
    if (revision !== metadata.revision) throw new Error("conflict");
    const { draftRequest: _draft, tripId: _trip, ...base } = metadata;
    metadata = { ...base, ...next, revision: revision + 1 }; return metadata;
  }) };
  return { input: { conversationId, tripId, now, request, client, conversations }, change: (next: Partial<ServerConversation>) => { metadata = { ...metadata, ...next }; }, metadata: () => metadata };
}
describe("explicit conversation draft save", () => {
  it("reads back copied conditions before atomically linking authoritative Conversation and clearing draft", async () => {
    const f = fixture(); const trip = await createConversationDraftTrip(f.input);
    expect(trip.request).toEqual(f.input.request);
    expect(f.input.client.get).toHaveBeenCalledBefore(f.input.conversations.update);
    expect(f.input.conversations.update).toHaveBeenCalledWith(conversationId, 3, expect.objectContaining({ tripId, scope: "trip" }));
    expect(f.metadata().draftRequest).toBeUndefined(); expect(f.metadata().tripId).toBe(tripId);
  });
  it("retries create with identical identity, timestamp and conditions after response loss", async () => {
    const f = fixture(); f.input.client.create.mockRejectedValueOnce(new Error("response lost"));
    await expect(createConversationDraftTrip(f.input)).rejects.toThrow("response lost");
    await createConversationDraftTrip(f.input);
    expect(f.input.client.create.mock.calls[0]).toEqual(f.input.client.create.mock.calls[1]);
  });
  it("recovers a lost link response without creating another Trip", async () => {
    const f = fixture(), update = f.input.conversations.update.getMockImplementation()!;
    f.input.conversations.update.mockImplementationOnce(async (...args) => { await update(...args); throw new Error("lost"); });
    await expect(createConversationDraftTrip(f.input)).rejects.toThrow("lost");
    await createConversationDraftTrip(f.input); expect(f.input.client.create).toHaveBeenCalledOnce();
  });
  it("preserves concurrently edited draft conditions and does not attach the stale copy", async () => {
    const f = fixture(); f.input.client.get.mockImplementationOnce(async () => {
      f.change({ draftRequest: { ...f.input.request, goal: "別の希望" }, revision: 4 });
      return createTrip(tripId, "新しい旅程", now, [], f.input.request);
    });
    await expect(createConversationDraftTrip(f.input)).rejects.toThrow("引き継ぎを中止");
    expect(f.input.conversations.update).not.toHaveBeenCalled(); expect(f.metadata().draftRequest?.goal).toBe("別の希望");
  });
  it("rejects stale drafts before create and cannot replace another Trip", async () => {
    const f = fixture(); f.change({ draftRequest: { ...f.input.request, goal: "更新" } });
    await expect(createConversationDraftTrip(f.input)).rejects.toThrow("条件が変わりました");
    f.change({ tripId: conversationId }); await expect(createConversationDraftTrip(f.input)).rejects.toThrow("reference changed");
    expect(f.input.client.create).not.toHaveBeenCalled();
  });
  it("does not link after an account switch", async () => {
    const f = fixture(); let epoch = 0; f.input.client.sessionVersion = () => epoch;
    f.input.client.get.mockImplementationOnce(async () => { epoch++; return createTrip(tripId, "新しい旅程", now, [], f.input.request); });
    await expect(createConversationDraftTrip(f.input)).rejects.toThrow("Account changed"); expect(f.input.conversations.update).not.toHaveBeenCalled();
  });
});
