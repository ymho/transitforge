import { expect, it } from "vitest";
import type { TripPlan } from "../../../domain/trip-plan";
import {
  tripPlanShareText,
  tripPlanTitleRegenerationPrompt,
} from "./trip-plan-panel";

it("builds share text from the title conditions and itinerary items", () => {
  const plan: TripPlan = {
    version: 1,
    id: "trip",
    title: "温泉街をのんびり歩く旅",
    destination: "城崎温泉",
    conditions: {
      adults: 2,
      children: 1,
      considerations: ["乗換を少なめにする"],
    },
    updatedAt: "2026-08-24T00:00:00Z",
    items: [{
      id: "stay",
      type: "stay",
      destination: "城崎温泉",
      checkInDate: "2026-09-05",
      checkOutDate: "2026-09-06",
    }],
  };

  expect(tripPlanShareText(plan)).toBe([
    "温泉街をのんびり歩く旅",
    "大人2人 子ども1人",
    "考慮事項: 乗換を少なめにする",
    "1. 城崎温泉での滞在 9月5日から1泊",
  ].join("\n"));
});

it("asks the concierge to regenerate only the persisted trip title", () => {
  const plan: TripPlan = {
    version: 1,
    id: "trip-title",
    title: "城崎温泉の旅",
    destination: "城崎温泉",
    updatedAt: "2026-08-24T00:00:00.000Z",
    items: [{
      id: "spot",
      type: "sightseeing",
      place: { name: "玄武洞", provider: "manual" },
    }],
  };

  const prompt = tripPlanTitleRegenerationPrompt(plan);
  expect(prompt).toContain("現在とは異なる旅のタイトルを1つ再生成");
  expect(prompt).toContain("metadata.title");
  expect(prompt).toContain("玄武洞");
  expect(prompt).toContain("行程は変更せず");
});
