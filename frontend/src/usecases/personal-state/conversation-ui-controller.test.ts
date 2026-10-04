import { describe, expect, it, vi } from "vitest";
import { ConversationUiController } from "./conversation-ui-controller";

const tripId = "22222222-2222-4222-8222-222222222222";
const conversation = (id: string, revision = 1) => ({ conversationId: id, title: id, scope: "trip" as const, tripId, summary: "", resolvedTopics: [], pendingTopics: [], createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", revision, messageCount: 0 });

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
    await expect(controller.create({ tripId })).rejects.toThrow("offline");
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
it("looks up a Trip's history by its immutable identity without scanning or selecting other chats", async () => {
  const first = conversation("first"), id = "75300000-0000-4000-8000-000000000002";
  const target = { ...conversation(id), tripId: id };
  const client = { ...fake({ items: [first] }), list: vi.fn(async () => ({ items: [first] })), get: vi.fn(async () => target) };
  const controller = new ConversationUiController(client); await controller.hydrate(); client.list.mockClear();
  expect((await controller.findForTrip(id))?.id).toBe(id);
  expect(client.get).toHaveBeenCalledExactlyOnceWith(id); expect(client.list).not.toHaveBeenCalled();
  expect(controller.active()?.id).toBe(first.conversationId);
});
it("creating a navigation candidate does not switch the selected conversation", async () => {
  const controller = new ConversationUiController(fake({ items: [conversation("a")] }));
  await controller.hydrate(); await controller.create({ tripId }, false);
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
  expect(messages).toHaveLength(50); expect(messages[0]).toMatchObject({ response: { text: "message-23" } });
  expect(messages.at(-1)).toMatchObject({ response: { text: "message-72" } });
  expect(history.mock.calls[0][1]).toEqual({ limit: 50, after: "000000000022" });
});




