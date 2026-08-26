import { describe, expect, it } from "vitest";

import { lightPresetForRouteTime, uiColorModeForLightPreset } from "./map-lighting";

describe("map lighting", () => {
  it("selects all four Mapbox presets from fixed time ranges", () => {
    expect(lightPresetForRouteTime(4 * 60 + 59)).toBe("night");
    expect(lightPresetForRouteTime(5 * 60)).toBe("dawn");
    expect(lightPresetForRouteTime(7 * 60 + 59)).toBe("dawn");
    expect(lightPresetForRouteTime(8 * 60)).toBe("day");
    expect(lightPresetForRouteTime(15 * 60 + 59)).toBe("day");
    expect(lightPresetForRouteTime(16 * 60)).toBe("dusk");
    expect(lightPresetForRouteTime(19 * 60 + 59)).toBe("dusk");
    expect(lightPresetForRouteTime(20 * 60)).toBe("night");
  });

  it("maps dawn and day to the day UI, and dusk and night to the night UI", () => {
    expect(uiColorModeForLightPreset("dawn")).toBe("day");
    expect(uiColorModeForLightPreset("day")).toBe("day");
    expect(uiColorModeForLightPreset("dusk")).toBe("night");
    expect(uiColorModeForLightPreset("night")).toBe("night");
  });

  it("treats times after midnight as the following day", () => {
    expect(lightPresetForRouteTime(25 * 60)).toBe("night");
    expect(lightPresetForRouteTime(30 * 60)).toBe("dawn");
  });
});
