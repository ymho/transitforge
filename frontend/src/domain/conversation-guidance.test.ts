import { describe, expect, it } from "vitest";
import {
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

});
