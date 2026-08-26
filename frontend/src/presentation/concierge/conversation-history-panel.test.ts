import { describe, expect, it } from "vitest";

import type { ConversationSession } from "../../domain/conversation-session";
import {
  conversationHistoryListItems,
  conversationUpdatedLabel,
} from "./conversation-history-panel";

describe("conversation history presentation", () => {
  const now = new Date("2026-08-25T12:00:00+09:00");

  it("orders recent conversations and marks active and trip sessions", () => {
    const sessions = [
      session("older", "城崎の相談", "2026-08-23T10:00:00+09:00"),
      session("active", "出雲の相談", "2026-08-25T09:30:00+09:00"),
    ];

    expect(conversationHistoryListItems(
      sessions,
      "active",
      (id) => id === "active",
      now,
    )).toEqual([
      expect.objectContaining({
        id: "active",
        title: "出雲の相談",
        updatedLabel: "09:30",
        active: true,
        hasTripPlan: true,
      }),
      expect.objectContaining({ id: "older", active: false, hasTripPlan: false }),
    ]);
  });

  it("uses readable relative labels without guessing invalid dates", () => {
    expect(conversationUpdatedLabel("2026-08-24T18:00:00+09:00", now)).toBe("昨日");
    expect(conversationUpdatedLabel("broken", now)).toBe("更新日時不明");
  });

  it("keeps a fresh empty conversation out of past history", () => {
    expect(conversationHistoryListItems(
      [session("new", "新しい会話", "2026-08-25T10:00:00+09:00")],
      "new",
      () => false,
      now,
    )).toEqual([]);
  });
});

function session(id: string, title: string, updatedAt: string): ConversationSession {
  return {
    id,
    title,
    scope: "general",
    summary: "",
    resolvedTopics: [],
    pendingTopics: [],
    createdAt: updatedAt,
    updatedAt,
  };
}
