import { describe, expect, it } from "vitest";

import type { JourneyRouteLeg, JourneyRouteResult } from "./direct-route-search";
import { journeyLegAlternativeFits } from "./journey-leg-alternative";

const leg = (
  serviceUid: string,
  originStation: string,
  destinationStation: string,
  departureTimeMinutes: number,
  arrivalTimeMinutes: number,
): JourneyRouteLeg => ({
  serviceUid,
  trainNumber: serviceUid,
  serviceType: "普通",
  trainName: "",
  originStation,
  destinationStation,
  departureTimeMinutes,
  arrivalTimeMinutes,
});

describe("journeyLegAlternativeFits", () => {
  const journey: JourneyRouteResult = {
    departureTimeMinutes: 420,
    arrivalTimeMinutes: 510,
    transferCount: 2,
    legs: [
      leg("a", "京都", "新大阪", 420, 450),
      leg("b", "新大阪", "大阪", 460, 465),
      leg("c", "大阪", "神戸", 475, 510),
    ],
  };

  it("accepts a direct replacement that preserves both connections", () => {
    expect(journeyLegAlternativeFits(
      journey,
      1,
      leg("local", "新大阪駅", "大阪駅", 457, 468),
    )).toBe(true);
  });

  it("rejects a replacement that breaks the following connection", () => {
    expect(journeyLegAlternativeFits(
      journey,
      1,
      leg("late", "新大阪", "大阪", 457, 471),
    )).toBe(false);
  });

  it("uses a wider connection margin for relaxed transfers", () => {
    const alternative = leg("tight", "新大阪", "大阪", 455, 465);
    expect(journeyLegAlternativeFits(journey, 1, alternative, "standard")).toBe(true);
    expect(journeyLegAlternativeFits(journey, 1, alternative, "relaxed")).toBe(false);
  });
});
