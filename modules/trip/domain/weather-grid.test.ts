import { describe, expect, it } from "vitest";

import {
  isInJapanWeatherArea,
  japanWeatherGridPoints,
  localWeatherMode,
  nearestWeatherObservation,
} from "./weather-grid";

describe("localWeatherMode", () => {
  it("classifies precipitation before cloud cover", () => {
    expect(localWeatherMode(0, 0.5, 10)).toBe("rain");
    expect(localWeatherMode(73, 0.5, 100)).toBe("snow");
    expect(localWeatherMode(2, 0, 60)).toBe("cloudy");
    expect(localWeatherMode(0, 0, 10)).toBe("clear");
  });
});

describe("isInJapanWeatherArea", () => {
  it("accepts Japanese coordinates and rejects coordinates outside the supported area", () => {
    expect(isInJapanWeatherArea({ latitude: 34.7, longitude: 135.5 })).toBe(true);
    expect(isInJapanWeatherArea({ latitude: 22.3, longitude: 114.2 })).toBe(false);
  });
});

describe("Japan weather samples", () => {
  it("covers Japan within one bounded provider request", () => {
    const points = japanWeatherGridPoints();
    expect(points.length).toBeGreaterThan(40);
    expect(points.length).toBeLessThanOrEqual(64);
    expect(points.every(isInJapanWeatherArea)).toBe(true);
  });

  it("selects the nearest prefetched observation", () => {
    const observations = [
      observation("west", 34, 132, "clear"),
      observation("east", 35, 140, "rain"),
    ];
    expect(nearestWeatherObservation(observations, {
      latitude: 35.6,
      longitude: 139.7,
    })?.id).toBe("east");
  });
});

function observation(
  id: string,
  latitude: number,
  longitude: number,
  mode: "clear" | "rain",
) {
  return {
    id,
    latitude,
    longitude,
    observedAt: "2026-08-30T14:00",
    mode,
    precipitationMillimeters: mode === "rain" ? 2 : 0,
    cloudCoverPercent: mode === "rain" ? 90 : 10,
    weatherCode: mode === "rain" ? 61 : 0,
  } as const;
}
