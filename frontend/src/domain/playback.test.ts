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

  it("converts the current Japan clock to route minutes regardless of device timezone", () => {
    expect(currentRouteTime(new Date("2026-07-29T23:37:30.500+09:00"))).toBeCloseTo(
      1_417 + 30.5 / 60,
    );
    expect(currentRouteTime(new Date("2026-07-29T15:37:00.000Z"))).toBe(24 * 60 + 37);
    expect(currentRouteTime(new Date("2026-07-29T18:59:00.000Z"))).toBe(27 * 60 + 59);
    expect(currentRouteTime(new Date("2026-07-29T19:00:00.000Z"))).toBe(4 * 60);
  });

  it("normalizes only early-morning clock times into the previous operating day", () => {
    expect(operatingDayRouteTime(30)).toBe(24 * 60 + 30);
    expect(operatingDayRouteTime(4 * 60)).toBe(4 * 60);
    expect(operatingDayRouteTime(25 * 60 + 5)).toBe(25 * 60 + 5);
  });
});
