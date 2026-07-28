import { describe, expect, it } from "vitest";

import {
  isSceneMode,
  lightPresetForSceneMode,
  sceneModeStyleFor,
} from "./map-scene-mode";

describe("map scene mode", () => {
  it("keeps the regular theme and route-time light in normal mode", () => {
    expect(sceneModeStyleFor("normal")).toEqual({
      theme: "default",
      routeLineWidth: 1.5,
      routeLineOpacity: 0.48,
    });
    expect(lightPresetForSceneMode("normal", "night")).toBe("night");
  });

  it("uses a faded daytime presentation in model mode", () => {
    expect(sceneModeStyleFor("model")).toEqual({
      theme: "faded",
      routeLineWidth: 2,
      routeLineOpacity: 0.72,
      lightPresetOverride: "day",
    });
    expect(lightPresetForSceneMode("model", "night")).toBe("day");
  });

  it("accepts only supported scene modes", () => {
    expect(isSceneMode("normal")).toBe(true);
    expect(isSceneMode("model")).toBe(true);
    expect(isSceneMode("spring")).toBe(false);
  });
});
