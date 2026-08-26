import { describe, expect, it } from "vitest";

import type { JourneyRouteResult } from "@raiquora/journey/direct-route-search";
import { createTravelCandidate } from "./travel-candidate";

const journey: JourneyRouteResult = {
  departureTimeMinutes: 420,
  arrivalTimeMinutes: 660,
  transferCount: 1,
  legs: [],
};

describe("travel candidate", () => {
  it("宿泊と体験だけを旅行費用へ合計し 鉄道運賃を含めない", () => {
    const candidate = createTravelCandidate({
      id: "kyoto-izumo-20260816",
      journey,
      accommodations: [{
        kind: "accommodation",
        provider: "example-provider",
        providerItemId: "stay-1",
        name: "出雲の宿",
        checkInDate: "2026-08-16",
        checkOutDate: "2026-08-17",
        price: { amount: 12_000, currency: "JPY" },
      }],
      experiences: [{
        kind: "experience",
        provider: "example-provider",
        providerItemId: "experience-1",
        name: "街歩き",
        startDate: "2026-08-17",
        price: { amount: 2_500, currency: "JPY" },
      }],
    });

    expect(candidate.expenseSummary).toEqual({
      currency: "JPY",
      accommodationAmount: 12_000,
      experienceAmount: 2_500,
      knownTotalAmount: 14_500,
      pricedItemCount: 2,
      hasUnpricedItems: false,
      excludesRailFare: true,
    });
  });

  it("料金不明の候補を保持しつつ 合計へ推定額を混ぜない", () => {
    const candidate = createTravelCandidate({
      id: "kyoto-izumo-20260816",
      journey,
      accommodations: [{
        kind: "accommodation",
        provider: "example-provider",
        providerItemId: "stay-unknown-price",
        name: "出雲の宿",
        checkInDate: "2026-08-16",
        checkOutDate: "2026-08-17",
      }],
    });

    expect(candidate.expenseSummary).toMatchObject({
      knownTotalAmount: 0,
      pricedItemCount: 0,
      hasUnpricedItems: true,
      excludesRailFare: true,
    });
  });

  it.each([-1, 1.5])("不正な旅行費用を受け付けない: %s円", (amount) => {
    expect(() => createTravelCandidate({
      id: "invalid-price",
      journey,
      experiences: [{
        kind: "experience",
        provider: "example-provider",
        providerItemId: "experience-1",
        name: "体験",
        startDate: "2026-08-17",
        price: { amount, currency: "JPY" },
      }],
    })).toThrow("旅行費用は0以上の整数円で指定してください。");
  });
});
