import { describe, expect, it } from "vitest";
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
    client.history = () => new Promise((resolve) => { resolveHistory = resolve; });
    const controller = new ConversationUiController(client);
    await controller.hydrate();
    const pending = controller.loadHistory("a");
    controller.selectLocal("b"); resolveHistory({ items: [] });
    await expect(pending).resolves.toEqual([]);
  });

  it("does not retain a local conversation when create fails", async () => {
    const client = fake({ items: [] }); client.create = async () => { throw new Error("offline"); };
    const controller = new ConversationUiController(client);
    await expect(controller.create()).rejects.toThrow("offline");
    expect(controller.list()).toEqual([]);
  });
});

function fake(page: { items: ReturnType<typeof conversation>[] }) {
  return {
    list: async () => page, create: async () => conversation("created"), get: async () => undefined,
    history: async () => ({ items: [] }), update: async () => conversation("updated"), delete: async () => ({ complete: true }),
  };
}
