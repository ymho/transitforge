import { describe, expect, it, vi } from "vitest";

import { applyWeather, isWeatherMode } from "./map-weather";

describe("map weather", () => {
  it("clears precipitation for clear weather", () => {
    const map = { setRain: vi.fn(), setSnow: vi.fn() };

    applyWeather(map, "clear");

    expect(map.setRain).toHaveBeenCalledOnce();
    expect(map.setRain).toHaveBeenCalledWith(null);
    expect(map.setSnow).toHaveBeenCalledOnce();
    expect(map.setSnow).toHaveBeenCalledWith(null);
  });

  it("keeps rain and snow mutually exclusive", () => {
    const map = { setRain: vi.fn(), setSnow: vi.fn() };

    applyWeather(map, "rain");

    expect(map.setSnow).toHaveBeenCalledWith(null);
    expect(map.setRain).toHaveBeenLastCalledWith(
      expect.objectContaining({ density: 0.65 }),
    );
  });

  it("recognizes only supported button values", () => {
    expect(isWeatherMode("snow")).toBe(true);
    expect(isWeatherMode("cloudy")).toBe(false);
  });
});
