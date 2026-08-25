import { describe, expect, it } from "vitest";
import { LocalConversationHistoryRepository } from "./conversation-history-repository";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("LocalConversationHistoryRepository", () => {
  it("assigns stable message IDs and restores them", () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const repository = new LocalConversationHistoryRepository(
      storage,
      () => `message-${++sequence}`,
    );

    repository.append("session-1", { role: "user", text: "京都へ行きたい" });
    repository.append("session-1", {
      role: "assistant",
      response: "案内します",
      requestId: "request-1",
    });

    expect(repository.list("session-1")).toEqual([
      { messageId: "message-1", role: "user", text: "京都へ行きたい" },
      {
        messageId: "message-2",
        role: "assistant",
        response: "案内します",
        requestId: "request-1",
      },
    ]);
  });
});
