import { describe, expect, it } from "vitest";

import {
  loadJourneySearchPreferences,
  journeyDelayLabel,
  nextTripConversationState,
  normalizedFeedbackComment,
  shouldFocusAiGuideInputOnOpen,
  visibleAssistantText,
} from "./ai-guide-panel";

describe("AI guide trip conversation state", () => {
  it("keeps the current trip context across a trip plan update response", () => {
    const current = {
      destinationWish: "宮島",
      startDate: "2026-08-31",
      nights: 1,
    };

    expect(nextTripConversationState(current, {
      text: "帰りの経路を変更します",
      tripPlanUpdate: { summary: "帰りを変更", patches: [] },
    })).toEqual({ guidance: undefined, tripContext: current });
  });

  it("updates only the trip context supplied by a follow-up question", () => {
    const next = { destinationWish: "宮島", startDate: "2026-09-01", nights: 2 };
    expect(nextTripConversationState({ destinationWish: "宮島" }, {
      text: "日程を確認します",
      conversation: {
        question: "何泊しますか",
        expectedInput: "stay-length",
        quickReplies: [],
        tripContext: next,
      },
    })).toEqual({
      guidance: expect.objectContaining({ tripContext: next }),
      tripContext: next,
    });
  });
});

describe("AI guide journey preferences", () => {
  it("loads valid preferences and ignores invalid saved values", () => {
    expect(loadJourneySearchPreferences({
      getItem: () => JSON.stringify({
        transferPace: "relaxed",
        rankingPreference: "fewest-transfers",
      }),
    })).toEqual({
      transferPace: "relaxed",
      rankingPreference: "fewest-transfers",
      maxTransfers: 3,
    });
    expect(loadJourneySearchPreferences({
      getItem: () => "broken",
    })).toMatchObject({
      transferPace: "standard",
      rankingPreference: "balanced",
    });
  });
});

describe("feedback comment", () => {
  it("trims an optional comment without inventing content", () => {
    expect(normalizedFeedbackComment(" 条件が反映されていません "))
      .toBe("条件が反映されていません");
    expect(normalizedFeedbackComment("   ")).toBeUndefined();
  });
});


describe("AI guide panel focus", () => {
  it("does not focus the input when opened on a narrow viewport", () => {
    expect(shouldFocusAiGuideInputOnOpen(390, false)).toBe(false);
  });

  it("does not focus the input on a coarse-pointer device", () => {
    expect(shouldFocusAiGuideInputOnOpen(1024, true)).toBe(false);
  });

  it("focuses the input when opened on a desktop", () => {
    expect(shouldFocusAiGuideInputOnOpen(1024, false)).toBe(true);
  });
});

describe("AI guide panel assistant text", () => {
  it("removes a thinking block while preserving the visible answer", () => {
    expect(
      visibleAssistantText(
        "<thinking>\n候補を比較します。\n</thinking>\n天気を雨に変更しました。",
      ),
    ).toBe("天気を雨に変更しました。");
  });

  it("does not display an unclosed thinking block", () => {
    expect(
      visibleAssistantText("混雑表示を有効にしました。\n<thinking>追加の検討"),
    ).toBe("混雑表示を有効にしました。");
  });

  it("uses a completion message when only thinking is returned", () => {
    expect(visibleAssistantText("<THINKING>内部処理</THINKING>")).toBe(
      "案内を完了しました。",
    );
  });

  it("shows only the content inside a response block", () => {
    expect(
      visibleAssistantText(
        "<thinking>天気を確認</thinking><response>天気を雨に設定しました。</response>",
      ),
    ).toBe("天気を雨に設定しました。");
  });

  it("unwraps a response block without a closing tag", () => {
    expect(
      visibleAssistantText("<response>目的地アーチを表示しました。"),
    ).toBe("目的地アーチを表示しました。");
  });

  it("uses a complete response even when the thinking block is unclosed", () => {
    expect(
      visibleAssistantText(
        "<thinking>内部処理が途中です<response>雨に設定しました。</response>",
      ),
    ).toBe("雨に設定しました。");
  });

  it("preserves a plain response from a model that does not use tags", () => {
    expect(visibleAssistantText("天気を雨に変更しました。")).toBe(
      "天気を雨に変更しました。",
    );
  });
});

describe("AI guide journey delay", () => {
  const leg = {
    serviceUid: "102M",
    trainNumber: "102M",
    serviceType: "新快速",
    trainName: "",
    originStation: "姫路",
    destinationStation: "京都",
    departureTimeMinutes: 622,
    arrivalTimeMinutes: 714,
  };

  it("distinguishes observed delay from an estimate", () => {
    expect(journeyDelayLabel({
      ...leg,
      delayMinutes: 12,
      delayStatus: "observed",
    })).toBe("遅延 +12分");
    expect(journeyDelayLabel({
      ...leg,
      delayMinutes: 12,
      delayStatus: "estimated",
    })).toBe("遅延見込み +12分");
  });

  it("hides a zero delay", () => {
    expect(journeyDelayLabel({ ...leg, delayMinutes: 0 })).toBeUndefined();
  });
});
