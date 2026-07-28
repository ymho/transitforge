import { describe, expect, it } from "vitest";

import { advanceRouteTime } from "./playback";

describe("playback", () => {
  const range = { minimum: 0, maximum: 1_560 };

  it("advances by the selected number of minutes per second", () => {
    expect(advanceRouteTime(600, 500, 10, range)).toBe(605);
    expect(advanceRouteTime(600, 1_000, 1 / 60, range)).toBeCloseTo(600 + 1 / 60);
  });

  it("wraps after a time range that extends beyond midnight", () => {
    expect(advanceRouteTime(1_559, 2_000, 1, range)).toBe(1);
  });
});
