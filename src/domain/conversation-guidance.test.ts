import { describe, expect, it } from "vitest";
import {
  normalizedConversationGuidance,
  promptWithConversationContext,
} from "./conversation-guidance";

describe("conversation guidance", () => {
  it("limits and normalizes quick replies for the presentation layer", () => {
    const result = normalizedConversationGuidance({
      question: " 何泊しますか？ ",
      expectedInput: "stay-length",
      quickReplies: [
        { label: " 日帰り ", value: " 日帰り " },
        { label: "日帰り", value: "日帰り" },
        { label: "1泊", value: "1泊" },
        { label: "2泊", value: "2泊" },
        { label: "3泊", value: "3泊" },
        { label: "4泊", value: "4泊" },
      ],
      tripContext: { destinationWish: "出雲大社" },
    });

    expect(result.question).toBe("何泊しますか？");
    expect(result.quickReplies).toHaveLength(5);
    expect(result.quickReplies[0]).toEqual({ label: "日帰り", value: "日帰り" });
  });

  it("adds prior question and TripContext only for a continued consultation", () => {
    expect(promptWithConversationContext("明日")).toBe("明日");
    expect(promptWithConversationContext("明日", {
      answer: "明日",
      guidance: {
        question: "いつ出発しますか？",
        expectedInput: "departure-date",
        quickReplies: [],
        tripContext: { destinationWish: "出雲大社" },
      },
    })).toContain('"destinationWish":"出雲大社"');
  });
});
