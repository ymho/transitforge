import { describe, expect, it } from "vitest";

import {
  hasExplicitReturnArrivalTime,
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
      context: { destinationWish: "宮島", planningStage: "planning", stayNights: 1 },
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

  it("drops model-proposed travel times that the user never supplied", () => {
    expect(mergeAuthoritativeTripContext({
      destinationWish: "奈良公園",
      outboundDepartureTimeMinutes: 8 * 60,
      returnArrivalTimeMinutes: 21 * 60,
    }, "奈良公園へ旅行したい", now)).toEqual({ destinationWish: "奈良公園" });
  });

  it("keeps quick replies aligned with the expected answer", () => {
    expect(quickReplyMatchesExpectedInput("旅程を考えたい", "planning-intent")).toBe(true);
    expect(quickReplyMatchesExpectedInput("明日", "planning-intent")).toBe(false);
    expect(quickReplyMatchesExpectedInput("1泊", "departure-date")).toBe(false);
    expect(quickReplyMatchesExpectedInput("明日", "departure-date")).toBe(true);
    expect(quickReplyMatchesExpectedInput("1泊", "stay-length")).toBe(true);
  });

  it("moves from inspiration to planning only after the user opts in", () => {
    const context = { destinationWish: "出雲大社", planningStage: "inspiration" } as const;
    expect(tripContextAfterUserAnswer(context, "もう少し見たい", now).planningStage)
      .toBe("inspiration");
    expect(tripContextAfterUserAnswer(context, "旅程を考えたい", now).planningStage)
      .toBe("planning");
  });

  it("treats an outbound and home-arrival window as a day trip", () => {
    const facts = travelConversationFacts([
      '現在の旅行条件: {"destinationWish":"奈良公園","startDate":"2026-08-31"}',
      "利用者の今回の回答: 朝9:00に出て、夜の21:00には帰ってきたい",
    ].join("\n"), now);

    expect(facts.context).toMatchObject({
      stayNights: 0,
      outboundDepartureTimeMinutes: 9 * 60,
      returnArrivalTimeMinutes: 21 * 60,
    });
    expect(facts.hasExplicitStayLength).toBe(true);
  });

  it("retains a clarified home-arrival deadline", () => {
    expect(tripContextAfterUserAnswer({
      destinationWish: "奈良公園",
      startDate: "2026-08-31",
      endDate: "2026-08-31",
      stayNights: 0,
    }, "夜の21:00には家についていたい", now)).toMatchObject({
      returnArrivalTimeMinutes: 21 * 60,
    });
  });

  it("distinguishes a new return deadline from a retained one", () => {
    expect(hasExplicitReturnArrivalTime([
      '現在の旅行条件: {"returnArrivalTimeMinutes":1260}',
      "利用者の今回の回答: 夜の21:00には家についていたい",
    ].join("\n"))).toBe(true);
    expect(hasExplicitReturnArrivalTime([
      '現在の旅行条件: {"returnArrivalTimeMinutes":1260}',
      "利用者の今回の回答: 奈良公園では何ができますか",
    ].join("\n"))).toBe(false);
  });

  it("uses the preceding return-arrival question to understand a short time answer", () => {
    const prompt = [
      '現在の旅行条件: {"destinationWish":"出雲大社","planningStage":"planning","startDate":"2026-08-31","endDate":"2026-09-02","stayNights":2}',
      "直前の質問: 帰りの向日町駅への到着希望時刻を教えてください",
      "利用者の今回の回答: 到着は21:0ゴロにしたい",
    ].join("\n");

    expect(travelConversationFacts(prompt, now).context).toMatchObject({
      destinationWish: "出雲大社",
      stayNights: 2,
      returnArrivalTimeMinutes: 21 * 60,
    });
    expect(hasExplicitReturnArrivalTime(prompt)).toBe(true);
  });
});

describe("tripContextAfterUserAnswer", () => {
  it("keeps the departure date while recording a later stay-length answer", () => {
    expect(tripContextAfterUserAnswer({
      destinationWish: "出雲大社",
      planningStage: "planning",
      startDate: "2026-08-31",
    }, "1泊", new Date("2026-08-30T13:00:00+09:00"))).toEqual({
      destinationWish: "出雲大社",
      planningStage: "planning",
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
