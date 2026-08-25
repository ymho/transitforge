import { describe, expect, it } from "vitest";
import { buildConversationFeedback } from "./conversation-feedback";

describe("buildConversationFeedback", () => {
  const messages = [
    { messageId: "message-1", role: "user" as const, text: "出雲へ行きたい" },
    {
      messageId: "message-2",
      role: "assistant" as const,
      response: "いつ出発しますか",
      requestId: "request-1",
    },
    { messageId: "message-3", role: "user" as const, text: "明日" },
    {
      messageId: "message-4",
      role: "assistant" as const,
      response: "経路を案内します",
      requestId: "request-2",
    },
  ];

  it("includes the repository history only through the selected answer", () => {
    const feedback = buildConversationFeedback(
      "session-1",
      messages,
      "message-2",
      "bad",
      " 日付を聞かないでほしい ",
    );

    expect(feedback.targetMessageId).toBe("message-2");
    expect(feedback.comment).toBe("日付を聞かないでほしい");
    expect(feedback.conversation.map(({ messageId }) => messageId))
      .toEqual(["message-1", "message-2"]);
    expect(feedback.requestIds).toEqual(["request-1"]);
  });

  it("rejects a missing or user target", () => {
    expect(() => buildConversationFeedback(
      "session-1", messages, "message-3", "bad",
    )).toThrow("評価対象");
    expect(() => buildConversationFeedback(
      "session-1", messages, "missing", "bad",
    )).toThrow("評価対象");
  });
});
