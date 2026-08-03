import { describe, expect, it } from "vitest";

import { lightPresetForRouteTime } from "./map-lighting";

describe("map lighting", () => {
  it("maps dawn and day to day mode, and dusk and night to night mode", () => {
    expect(lightPresetForRouteTime(4 * 60 + 59)).toBe("night");
    expect(lightPresetForRouteTime(5 * 60)).toBe("day");
    expect(lightPresetForRouteTime(7 * 60 + 59)).toBe("day");
    expect(lightPresetForRouteTime(8 * 60)).toBe("day");
    expect(lightPresetForRouteTime(15 * 60 + 59)).toBe("day");
    expect(lightPresetForRouteTime(16 * 60)).toBe("night");
    expect(lightPresetForRouteTime(19 * 60 + 59)).toBe("night");
    expect(lightPresetForRouteTime(20 * 60)).toBe("night");
  });

  it("treats times after midnight as the following day", () => {
    expect(lightPresetForRouteTime(25 * 60)).toBe("night");
    expect(lightPresetForRouteTime(30 * 60)).toBe("day");
  });
});
