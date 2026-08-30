import { describe, expect, it } from "vitest";

import {
  mergeAuthoritativeTripContext,
  quickReplyMatchesExpectedInput,
  tripContextAfterUserAnswer,
  travelConversationFacts,
} from "./travel-conversation-context";

const now = new Date("2026-08-27T12:00:00+09:00");

describe("travel conversation context", () => {
  it("keeps a stay length answer without inventing dates", () => {
    const facts = travelConversationFacts([
      "旅行相談の会話を継続しています。",
      '現在の旅行条件: {"destinationWish":"宮島"}',
      "回答の種類: departure-date",
      "利用者の今回の回答: 1泊",
    ].join("\n"), now);

    expect(facts).toEqual({
      context: { destinationWish: "宮島", stayNights: 1 },
      hasExplicitDate: false,
      hasExplicitStayLength: true,
    });
  });

  it("combines the retained stay length with a later departure date", () => {
    const facts = travelConversationFacts([
      '現在の旅行条件: {"destinationWish":"宮島","stayNights":1}',
      "利用者の今回の回答: 明日",
    ].join("\n"), now);

    expect(facts.context).toMatchObject({
      destinationWish: "宮島",
      startDate: "2026-08-28",
      endDate: "2026-08-29",
      stayNights: 1,
    });
  });

  it("drops model-proposed dates that were never supplied by the user", () => {
    expect(mergeAuthoritativeTripContext({
      destinationWish: "出雲大社",
      startDate: "2026-08-28",
      endDate: "2026-08-29",
    }, "出雲大社へ旅行したい", now)).toEqual({ destinationWish: "出雲大社" });
  });

  it("keeps quick replies aligned with the expected answer", () => {
    expect(quickReplyMatchesExpectedInput("1泊", "departure-date")).toBe(false);
    expect(quickReplyMatchesExpectedInput("明日", "departure-date")).toBe(true);
    expect(quickReplyMatchesExpectedInput("1泊", "stay-length")).toBe(true);
  });
});

describe("tripContextAfterUserAnswer", () => {
  it("keeps the departure date while recording a later stay-length answer", () => {
    expect(tripContextAfterUserAnswer({
      destinationWish: "出雲大社",
      startDate: "2026-08-31",
    }, "1泊", new Date("2026-08-30T13:00:00+09:00"))).toEqual({
      destinationWish: "出雲大社",
      startDate: "2026-08-31",
      endDate: "2026-09-01",
      stayNights: 1,
    });
  });

  it("does not discard known schedule facts on a confirmation answer", () => {
    const current = {
      destinationWish: "出雲大社",
      startDate: "2026-08-31",
      endDate: "2026-09-01",
      stayNights: 1,
    };
    expect(tripContextAfterUserAnswer(current, "はい、お願いします")).toEqual(current);
  });
});
