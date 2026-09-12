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
  it("allows discovery before a rail journey has been found", () => {
    const candidate = createTravelCandidate({ id: "discovery" });
    expect(candidate.journey).toBeUndefined();
    expect(candidate.accommodations).toEqual([]);
  });
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
        price: { price: { amountMinor: 12_000, currency: "JPY" }, observedAt: "2026-08-15T00:00:00Z" },
      }],
      experiences: [{
        kind: "experience",
        provider: "example-provider",
        providerItemId: "experience-1",
        name: "街歩き",
        startDate: "2026-08-17",
        price: { price: { amountMinor: 2_500, currency: "JPY" }, observedAt: "2026-08-15T00:00:00Z" },
      }],
    });

    expect(candidate.expenseSummary).toEqual({
      totals: [{ currency: "JPY", amountMinor: 14_500 }],
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
      totals: [],
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
        price: { price: { amountMinor: amount, currency: "JPY" }, observedAt: "2026-08-15T00:00:00Z" },
      }],
    })).toThrow("Invalid Money");
  });
});
