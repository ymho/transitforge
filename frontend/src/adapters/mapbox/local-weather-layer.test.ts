import { describe, expect, it, vi } from "vitest";

import { createLocalWeatherLayer } from "./local-weather-layer";

describe("createLocalWeatherLayer", () => {
  it("switches prefetched weather immediately as the map moves", () => {
    let center = { lat: 34.7, lng: 135.5 };
    let move: (() => void) | undefined;
    let animation: FrameRequestCallback | undefined;
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        animation = callback;
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
    });
    const map = {
      getCenter: () => center,
      on: (_event: "move", listener: () => void) => { move = listener; },
      off: vi.fn(),
    };
    const applyWeatherMode = vi.fn();
    const layer = createLocalWeatherLayer(map, applyWeatherMode);
    layer.setWeather([
      observation("kansai", 34.7, 135.5, "clear"),
      observation("kanto", 35.7, 139.7, "rain"),
    ]);

    expect(applyWeatherMode).toHaveBeenLastCalledWith("clear");
    center = { lat: 35.7, lng: 139.7 };
    move?.();
    animation?.(0);
    expect(applyWeatherMode).toHaveBeenLastCalledWith("rain");

    layer.setDetailedWeather(
      [observation("tokyo-detail", 35.7, 139.7, "clear")],
      { west: 139, south: 35, east: 140.5, north: 36.5 },
    );
    expect(applyWeatherMode).toHaveBeenLastCalledWith("clear");

    layer.dispose();
    vi.unstubAllGlobals();
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
