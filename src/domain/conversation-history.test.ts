import { describe, expect, it } from "vitest";
import {
  appendConversationHistory,
  conversationHistoryStorageKey,
  loadConversationHistory,
  recentConversationContext,
} from "./conversation-history";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("conversation history", () => {
  it("keeps histories separate by conversation session", () => {
    const storage = memoryStorage();
    appendConversationHistory(storage, "session-a", { role: "user", text: "出雲へ行きたい" });
    appendConversationHistory(storage, "session-b", { role: "user", text: "城崎へ行きたい" });

    expect(loadConversationHistory(storage, "session-a")).toEqual([
      { role: "user", text: "出雲へ行きたい" },
    ]);
    expect(loadConversationHistory(storage, "session-b")).toEqual([
      { role: "user", text: "城崎へ行きたい" },
    ]);
  });

  it("migrates the legacy history into the first active session", () => {
    const storage = memoryStorage({
      "transitforge.concierge-history.v1": JSON.stringify([
        { role: "user", text: "前の相談" },
      ]),
    });

    appendConversationHistory(storage, "session-a", { role: "assistant", response: "続けます" });

    expect(loadConversationHistory(storage, "session-a")).toHaveLength(2);
    expect(storage.getItem(conversationHistoryStorageKey)).toContain("session-a");
  });

  it("ignores malformed persisted entries", () => {
    const storage = memoryStorage({
      [conversationHistoryStorageKey]: JSON.stringify({
        version: 2,
        sessions: { valid: [{ role: "assistant", response: { unexpected: true } }] },
      }),
    });

    expect(loadConversationHistory(storage, "valid")).toEqual([]);
  });

  it("builds a compact context without duplicating the current prompt", () => {
    const context = recentConversationContext([
      { role: "user", text: "出雲へ行きたい" },
      { role: "assistant", response: { text: "いつ出発しますか", conversation: { question: "いつ出発しますか", expectedInput: "departure-date", quickReplies: [], tripContext: {} } } },
      { role: "user", text: "明日" },
    ], "明日");

    expect(context).toContain("出雲へ行きたい");
    expect(context).toContain("いつ出発しますか");
    expect(context).not.toContain("明日");
  });

  it("preserves the API request id with an assistant response", () => {
    const storage = memoryStorage();
    appendConversationHistory(storage, "session-a", {
      role: "assistant",
      response: "案内しました",
      requestId: "request-123",
    });

    expect(loadConversationHistory(storage, "session-a")[0]).toMatchObject({
      requestId: "request-123",
    });
  });
});
