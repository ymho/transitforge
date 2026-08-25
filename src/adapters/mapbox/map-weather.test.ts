import { describe, expect, it, vi } from "vitest";

import { applyWeather } from "./map-weather";

describe("map weather", () => {
  it("clears precipitation for clear weather", () => {
    const map = { setFog: vi.fn(), setRain: vi.fn(), setSnow: vi.fn() };

    applyWeather(map, "clear");

    expect(map.setRain).toHaveBeenCalledOnce();
    expect(map.setRain).toHaveBeenCalledWith(null);
    expect(map.setSnow).toHaveBeenCalledOnce();
    expect(map.setSnow).toHaveBeenCalledWith(null);
    expect(map.setFog).toHaveBeenCalledOnce();
    expect(map.setFog).toHaveBeenCalledWith(null);
  });

  it("uses Mapbox fog for a cloudy atmosphere", () => {
    const map = { setFog: vi.fn(), setRain: vi.fn(), setSnow: vi.fn() };

    applyWeather(map, "cloudy");

    expect(map.setRain).toHaveBeenCalledWith(null);
    expect(map.setSnow).toHaveBeenCalledWith(null);
    expect(map.setFog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        range: [-0.2, 2.5],
        "high-color": "#aeb9c0",
        "star-intensity": 0,
      }),
    );
  });

  it("combines rain with the cloudy atmosphere and clears snow", () => {
    const map = { setFog: vi.fn(), setRain: vi.fn(), setSnow: vi.fn() };

    applyWeather(map, "rain");

    expect(map.setSnow).toHaveBeenCalledWith(null);
    expect(map.setFog).toHaveBeenLastCalledWith(
      expect.objectContaining({ range: [-0.2, 2.5] }),
    );
    expect(map.setRain).toHaveBeenLastCalledWith(
      expect.objectContaining({ density: 0.65 }),
    );
  });

  it("combines snow with the cloudy atmosphere", () => {
    const map = { setFog: vi.fn(), setRain: vi.fn(), setSnow: vi.fn() };

    applyWeather(map, "snow");

    expect(map.setFog).toHaveBeenLastCalledWith(
      expect.objectContaining({ color: "#c8d0d5" }),
    );
    expect(map.setSnow).toHaveBeenLastCalledWith(
      expect.objectContaining({ density: 0.7 }),
    );
  });

});
