import { describe, expect, it } from "vitest";

import {
  advanceRouteTime,
  currentRouteTime,
  operatingDayRouteTime,
} from "./playback";

describe("playback", () => {
  const range = { minimum: 0, maximum: 1_560 };

  it("advances by the selected number of minutes per second", () => {
    expect(advanceRouteTime(600, 500, 10, range)).toBe(605);
    expect(advanceRouteTime(600, 1_000, 1 / 60, range)).toBeCloseTo(600 + 1 / 60);
  });

  it("wraps after a time range that extends beyond midnight", () => {
    expect(advanceRouteTime(1_559, 2_000, 1, range)).toBe(1);
  });

  it("converts the current local clock to route minutes", () => {
    expect(currentRouteTime(new Date(2026, 6, 29, 23, 37, 30, 500))).toBeCloseTo(
      1_417 + 30.5 / 60,
    );
    expect(currentRouteTime(new Date(2026, 6, 30, 0, 37))).toBe(24 * 60 + 37);
    expect(currentRouteTime(new Date(2026, 6, 30, 3, 59))).toBe(27 * 60 + 59);
    expect(currentRouteTime(new Date(2026, 6, 30, 4, 0))).toBe(4 * 60);
  });

  it("normalizes only early-morning clock times into the previous operating day", () => {
    expect(operatingDayRouteTime(30)).toBe(24 * 60 + 30);
    expect(operatingDayRouteTime(4 * 60)).toBe(4 * 60);
    expect(operatingDayRouteTime(25 * 60 + 5)).toBe(25 * 60 + 5);
  });
});
