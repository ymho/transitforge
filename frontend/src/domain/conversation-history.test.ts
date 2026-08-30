import { describe, expect, it } from "vitest";
import {
  appendConversationHistory,
  latestJourneyPlanFromHistory,
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
    appendConversationHistory(storage, "session-a", { messageId: "a-1", role: "user", text: "出雲へ行きたい" });
    appendConversationHistory(storage, "session-b", { messageId: "b-1", role: "user", text: "城崎へ行きたい" });

    expect(loadConversationHistory(storage, "session-a")).toEqual([
      { messageId: "a-1", role: "user", text: "出雲へ行きたい" },
    ]);
    expect(loadConversationHistory(storage, "session-b")).toEqual([
      { messageId: "b-1", role: "user", text: "城崎へ行きたい" },
    ]);
  });

  it("migrates the legacy history into the first active session", () => {
    const storage = memoryStorage({
      "transitforge.concierge-history.v1": JSON.stringify([
        { role: "user", text: "前の相談" },
      ]),
    });

    appendConversationHistory(storage, "session-a", { messageId: "a-2", role: "assistant", response: "続けます" });

    expect(loadConversationHistory(storage, "session-a")).toHaveLength(2);
    expect(storage.getItem(conversationHistoryStorageKey)).toContain("session-a");
  });

  it("reads v2 history with deterministic message IDs until it is rewritten", () => {
    const storage = memoryStorage({
      "transitforge.concierge-history.v2": JSON.stringify({
        version: 2,
        sessions: {
          "session-a": [{ role: "user", text: "以前の相談" }],
        },
      }),
    });

    expect(loadConversationHistory(storage, "session-a")).toEqual([{
      messageId: "legacy-message-1",
      role: "user",
      text: "以前の相談",
    }]);
    expect(loadConversationHistory(storage, "session-b")).toEqual([]);
  });

  it("ignores malformed persisted entries", () => {
    const storage = memoryStorage({
      [conversationHistoryStorageKey]: JSON.stringify({
        version: 3,
        sessions: { valid: [{ role: "assistant", response: { unexpected: true } }] },
      }),
    });

    expect(loadConversationHistory(storage, "valid")).toEqual([]);
  });

  it("builds a compact context without duplicating the current prompt", () => {
    const context = recentConversationContext([
      { messageId: "m-1", role: "user", text: "出雲へ行きたい" },
      { messageId: "m-2", role: "assistant", response: { text: "いつ出発しますか", conversation: { question: "いつ出発しますか", expectedInput: "departure-date", quickReplies: [], tripContext: {} } } },
      { messageId: "m-3", role: "user", text: "明日" },
    ], "明日");

    expect(context).toContain("出雲へ行きたい");
    expect(context).toContain("いつ出発しますか");
    expect(context).not.toContain("明日");
  });

  it("preserves the API request id with an assistant response", () => {
    const storage = memoryStorage();
    appendConversationHistory(storage, "session-a", {
      messageId: "m-1",
      role: "assistant",
      response: "案内しました",
      requestId: "request-123",
    });

    expect(loadConversationHistory(storage, "session-a")[0]).toMatchObject({
      requestId: "request-123",
    });
  });

  it("restores an external place response for feedback", () => {
    const storage = memoryStorage();
    appendConversationHistory(storage, "session-a", {
      messageId: "place-answer",
      role: "assistant",
      response: {
        text: "観光スポットを3件見つけました",
        external: {},
      },
      requestId: "request-place",
    });

    expect(loadConversationHistory(storage, "session-a")).toEqual([{
      messageId: "place-answer",
      role: "assistant",
      response: {
        text: "観光スポットを3件見つけました",
        external: {},
      },
      requestId: "request-place",
    }]);
  });

  it("restores the latest journey result with its search constraints", () => {
    const first = {
      originStation: "京都",
      destinationStation: "岡山",
      searchTimeMinutes: 480,
      journeys: [],
    };
    const latest = {
      originStation: "京都",
      destinationStation: "出雲市",
      searchTimeMinutes: 540,
      excludedServiceTypes: ["新幹線"],
      journeys: [],
    };

    expect(latestJourneyPlanFromHistory([
      { messageId: "m-1", role: "assistant", response: { text: "最初の経路", journeyPlan: first } },
      { messageId: "m-2", role: "user", text: "新幹線を使わない" },
      { messageId: "m-3", role: "assistant", response: { text: "変更後の経路", journeyPlan: latest } },
    ])).toEqual(latest);
  });

  it("does not mistake a travel plan or prose for the active journey result", () => {
    expect(latestJourneyPlanFromHistory([
      { messageId: "m-1", role: "assistant", response: "案内しました" },
      { messageId: "m-2", role: "user", text: "続けて" },
    ])).toBeUndefined();
  });
});
