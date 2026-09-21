import { describe, expect, it, vi } from "vitest";
import { ConversationUiController } from "./conversation-ui-controller";

const conversation = (id: string, revision = 1) => ({ conversationId: id, title: id, scope: "general" as const, summary: "", resolvedTopics: [], pendingTopics: [], createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", revision, messageCount: 0 });

describe("ConversationUiController", () => {
  it("hydrates only server conversations and keeps selection in memory", async () => {
    const client = fake({ items: [conversation("server-a")] });
    const controller = new ConversationUiController(client);
    await controller.hydrate();
    expect(controller.active()?.id).toBe("server-a");
    expect(controller.list()).toHaveLength(1);
  });

  it("does not publish stale history after another selection", async () => {
    let resolveHistory!: (value: { items: never[] }) => void;
    const client = fake({ items: [conversation("a"), conversation("b")] });
    client.get = async () => ({ ...conversation("a"), messageCount: 1 });
    client.history = () => new Promise((resolve) => { resolveHistory = resolve; });
    const controller = new ConversationUiController(client);
    await controller.hydrate();
    const pending = controller.loadHistory("a");
    await vi.waitFor(() => expect(resolveHistory).toBeDefined());
    controller.selectLocal("b"); resolveHistory({ items: [] });
    await expect(pending).resolves.toEqual([]);
  });

  it("does not retain a local conversation when create fails", async () => {
    const client = fake({ items: [] }); client.create = async () => { throw new Error("offline"); };
    const controller = new ConversationUiController(client);
    await expect(controller.create()).rejects.toThrow("offline");
    expect(controller.list()).toEqual([]);
  });

  it("does not restore an old account after clear while hydrate is pending", async () => {
    let resolveList!: (value: { items: ReturnType<typeof conversation>[] }) => void;
    const client = fake({ items: [] }); client.list = () => new Promise((resolve) => { resolveList = resolve; });
    const controller = new ConversationUiController(client);
    const pending = controller.hydrate(); controller.clear(); resolveList({ items: [conversation("account-a")] });
    await expect(pending).resolves.toBeUndefined(); expect(controller.list()).toEqual([]);
  });

  it("does not call the API while signed out", async () => {
    const client = fake({ items: [] });
    client.list = vi.fn(client.list);
    const controller = new ConversationUiController(client, () => false);
    await expect(controller.hydrate()).rejects.toThrow("Authentication required");
    expect(client.list).not.toHaveBeenCalled();
  });
});

function fake(page: { items: ReturnType<typeof conversation>[] }) {
  return {
    list: async () => page, create: async () => conversation("created"), get: async (id: string): Promise<ReturnType<typeof conversation> | undefined> => page.items.find(c => c.conversationId === id),
    history: async () => ({ items: [] }), update: async () => conversation("updated"), delete: async () => ({ complete: true }),
  };
}
it("finds a Trip conversation beyond the first page, with fresh identity, without selecting it", async () => {
  const first = { ...conversation("same-name-a"), tripId: "trip-a" };
  const target = { ...conversation("same-name-b"), tripId: "trip-b" };
  const client = { ...fake({ items: [first] }), list: vi.fn(async (page?: { after?: string }) => page?.after ? { items: [target] } : { items: [first], nextAfter: "next" }), get: async () => target };
  const controller = new ConversationUiController(client);
  await controller.hydrate();
  expect((await controller.findForTrip("trip-b"))?.id).toBe(target.conversationId);
  expect(controller.active()?.id).toBe(first.conversationId);
  expect(client.list).toHaveBeenCalledWith({ limit: 50, after: "next" });
});
it("creating a navigation candidate does not switch the selected conversation", async () => {
  const controller = new ConversationUiController(fake({ items: [conversation("a")] }));
  await controller.hydrate(); await controller.create({ tripId: "b" }, false);
  expect(controller.active()?.id).toBe("a");
});
it("restores structured proposal data from server history without a local writer", async () => {
  const tripUpdateProposal = { tripId: "11111111-1111-4111-8111-111111111111", baseRevision: 0, summary: "条件案", patches: [{ type: "request" as const, request: { constraints: [], assumptions: [] } }] as const };
  const client = { ...fake({ items: [{ ...conversation("a"), messageCount: 1 }] }), history: async () => ({ items: [{ role: "assistant" as const, text: "条件を確認", sequence: 1, createdAt: "2026-09-21T00:00:00Z", tripUpdateProposal }] }) };
  const controller = new ConversationUiController(client); await controller.hydrate();
  const entries = await controller.loadHistory("a");
  expect(entries[0]).toMatchObject({ role: "assistant", response: { text: "条件を確認", tripUpdateProposal } });
  expect(controller.historyRepository.list("a")).toEqual(entries);
  controller.clear(); expect(controller.historyRepository.list("a")).toEqual([]);
});
it("loads the latest 50 messages across byte pages, including proposals beyond the first page", async () => {
  const session = { ...conversation("a"), messageCount: 72 };
  const history = vi.fn(async (_id: string, page?: { limit?: number; after?: string }) => {
    const first = Number(page?.after ?? 0) + 1, count = Math.min(10, page?.limit ?? 50);
    return { items: Array.from({ length: count }, (_, i) => ({ role: "assistant" as const, text: `message-${first + i}`, sequence: first + i, createdAt: session.createdAt })) };
  });
  const controller = new ConversationUiController({ ...fake({ items: [session] }), history });
  await controller.hydrate(); const messages = await controller.loadHistory("a");
  expect(messages).toHaveLength(50); expect(messages[0]).toMatchObject({ response: "message-23" });
  expect(messages.at(-1)).toMatchObject({ response: "message-72" });
  expect(history.mock.calls[0][1]).toEqual({ limit: 50, after: "000000000022" });
});
it("saves consultation conditions with fresh CAS and read-back, and rejects conflicting edits", async () => {
  const id = "45300000-0000-4000-8000-000000000001", empty = { constraints: [], assumptions: [] };
  let saved: import("./server-conversation-client").ServerConversation = { ...conversation(id), draftRequest: empty };
  const update = vi.fn(async (_id: string, revision: number, metadata: import("./server-conversation-client").ServerConversationMetadata) => {
    expect(revision).toBe(saved.revision); saved = { ...saved, ...metadata, revision: revision + 1 }; return saved;
  });
  const controller = new ConversationUiController({ ...fake({ items: [] }), list: async () => ({ items: [saved] }), get: async () => saved, update });
  await controller.hydrate();
  await controller.saveDraftRequest(id, empty, { ...empty, goal: "温泉" });
  expect(controller.draftView(id)?.request.goal).toBe("温泉");
  await expect(controller.saveDraftRequest(id, empty, { ...empty, goal: "海" })).rejects.toThrow();
  expect(update).toHaveBeenCalledOnce();
  saved = { ...saved, tripId: id, draftRequest: undefined };
  await expect(controller.saveDraftRequest(id, { ...empty, goal: "温泉" }, empty)).rejects.toThrow();
});
it("keeps the Agent draft version stable when only the conversation title changes", async () => {
  const id = "11111111-1111-4111-8111-111111111111", draft = { constraints: [], assumptions: [] };
  let saved: import("./server-conversation-client").ServerConversation = { ...conversation(id), draftRequest: draft };
  const update = vi.fn(async (_id: string, revision: number, metadata: import("./server-conversation-client").ServerConversationMetadata) => {
    saved = { ...saved, ...metadata, revision: revision + 1 };
    return saved;
  });
  const controller = new ConversationUiController({ ...fake({ items: [] }), list: async () => ({ items: [saved] }), get: async () => saved, update });
  await controller.hydrate();
  const before = controller.draftRequestVersion(id);
  await controller.rename(id, "明日からの相談");
  expect(controller.draftRequestVersion(id)).toBe(before);
  expect(update).toHaveBeenCalledOnce();
});
it("restores the separate consultation proposal from server history", async () => {
  const id = "11111111-1111-4111-8111-111111111111", request = { constraints: [], assumptions: [] };
  const consultationRequestProposal = { conversationId: id, baseRequest: request, request: { ...request, goal: "美術館" }, summary: "目的の案" };
  const client = { ...fake({ items: [{ ...conversation(id), messageCount: 1 }] }), history: async () => ({ items: [{ role: "assistant" as const, text: "条件を確認", sequence: 1, createdAt: "2026-09-21T00:00:00Z", consultationRequestProposal }] }) };
  const controller = new ConversationUiController(client); await controller.hydrate();
  expect((await controller.loadHistory(id))[0]).toMatchObject({ role: "assistant", response: { text: "条件を確認", consultationRequestProposal } });
});
it("confirms draft proposals against fresh metadata and recovers a lost save response without applying twice", async () => {
  const id = "11111111-1111-4111-8111-111111111111", empty = { constraints: [], assumptions: [] };
  const next: import("@raiquora/trip/trip-request").TripRequest = { ...empty, assumptions: [{ id: "a", source: "model", status: "unconfirmed", text: "ゆっくり巡る仮置き", affects: [] }] };
  let saved: import("./server-conversation-client").ServerConversation = { ...conversation(id), draftRequest: empty };
  const update = vi.fn(async (_id: string, revision: number, metadata: import("./server-conversation-client").ServerConversationMetadata) => {
    expect(revision).toBe(3); saved = { ...saved, ...metadata, revision: 4 }; throw new Error("response lost");
  });
  const controller = new ConversationUiController({ ...fake({ items: [] }), list: async () => ({ items: [saved] }), get: async () => saved, update });
  await controller.hydrate(); saved = { ...saved, revision: 3, messageCount: 2 };
  await expect(controller.saveDraftRequest(id, empty, next)).rejects.toThrow("response lost");
  await controller.saveDraftRequest(id, empty, next);
  expect(controller.draftView(id)?.request).toEqual(next); expect(update).toHaveBeenCalledOnce();
  expect(controller.draftView(id)?.request.assumptions[0].status).toBe("unconfirmed");
});
