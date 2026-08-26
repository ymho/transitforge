import { describe, expect, it } from "vitest";

import { weatherHazeMixAtViewportPoint } from "./weather-haze";

describe("weather haze", () => {
  it("keeps trains near the view center clear", () => {
    expect(
      weatherHazeMixAtViewportPoint(
        { x: 500, y: 300 },
        { width: 1_000, height: 600 },
      ),
    ).toBe(0);
  });

  it("strongly blends distant trains into the cloudy atmosphere", () => {
    expect(
      weatherHazeMixAtViewportPoint(
        { x: 950, y: 30 },
        { width: 1_000, height: 600 },
      ),
    ).toBeCloseTo(0.9);
  });

  it("returns no haze for an unavailable viewport", () => {
    expect(
      weatherHazeMixAtViewportPoint(
        { x: 0, y: 0 },
        { width: 0, height: 0 },
      ),
    ).toBe(0);
  });
});
