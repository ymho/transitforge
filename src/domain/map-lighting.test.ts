import { describe, expect, it } from "vitest";

import { lightPresetForRouteTime } from "./map-lighting";

describe("map lighting", () => {
  it("selects a light preset from the displayed timetable time", () => {
    expect(lightPresetForRouteTime(4 * 60 + 59)).toBe("night");
    expect(lightPresetForRouteTime(5 * 60)).toBe("dawn");
    expect(lightPresetForRouteTime(8 * 60)).toBe("day");
    expect(lightPresetForRouteTime(16 * 60)).toBe("dusk");
    expect(lightPresetForRouteTime(20 * 60)).toBe("night");
  });

  it("treats times after midnight as the following day", () => {
    expect(lightPresetForRouteTime(25 * 60)).toBe("night");
  });
});
