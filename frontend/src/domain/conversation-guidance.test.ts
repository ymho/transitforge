import { describe, expect, it } from "vitest";
import {
  conversationQuestionWasAsked,
  conversationTextIsQuestion,
  normalizedConversationGuidance,
} from "./conversation-guidance";

describe("conversation guidance", () => {
  it("limits and normalizes quick replies for the presentation layer", () => {
    const result = normalizedConversationGuidance({
      recommendation: " まずは1泊で考えるのがおすすめです。 ",
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
    expect(result.recommendation).toBe("まずは1泊で考えるのがおすすめです。");
    expect(result.quickReplies).toHaveLength(5);
    expect(result.quickReplies[0]).toEqual({ label: "日帰り", value: "日帰り" });
  });

  it("detects direct and repeated questions without travel-specific branching", () => {
    expect(conversationTextIsQuestion("具体的な地域は決まっていますか？")).toBe(true);
    expect(conversationTextIsQuestion("海辺を静かに歩ける候補を探します。")).toBe(false);
    expect(conversationQuestionWasAsked(
      "具体的な地域は決まっていますか?",
      ["候補を考えます。\n\n具体的な地域は決まっていますか？"],
    )).toBe(true);
    expect(conversationQuestionWasAsked(
      "この場所を軸に旅を考えますか？",
      ["海辺で過ごせる候補を調べます。"],
    )).toBe(false);
  });

});
