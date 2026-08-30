import { describe, expect, it, vi } from "vitest";

import { configureLocalWeatherUpdates } from "./local-weather-updates";

describe("configureLocalWeatherUpdates", () => {
  it("prefetches Japan in one request and renders available observations", async () => {
    vi.stubGlobal("window", {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 2),
      clearTimeout: vi.fn(),
    });
    const listeners = new Map<string, () => void>();
    const map = {
      getBounds: () => ({
        getWest: () => 135,
        getSouth: () => 34,
        getEast: () => 136,
        getNorth: () => 35,
      }),
      getZoom: () => 10,
      on: (event: "moveend", listener: () => void) => listeners.set(event, listener),
      off: (event: "moveend") => listeners.delete(event),
    };
    const setWeather = vi.fn();
    const setDetailedWeather = vi.fn();
    const layer = {
      setWeather,
      setDetailedWeather,
      clearDetailedWeather: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    };
    const search = vi.fn(async (request: { points: Array<{ id: string; latitude: number; longitude: number }> }) => ({
      weatherGrid: {
        status: "available",
        data: { cells: request.points.map((point) => ({
          ...point,
          observedAt: "2026-08-30T14:00",
          mode: "clear" as const,
          precipitationMillimeters: 0,
          cloudCoverPercent: 10,
          weatherCode: 0,
        })) },
      },
    }));

    const controller = configureLocalWeatherUpdates(map, layer, search, () => undefined);
    await controller.refresh();

    const requestedPointCounts = search.mock.calls.map(([request]) => request.points.length);
    expect(requestedPointCounts).toContain(62);
    expect(requestedPointCounts).toContain(9);
    expect(setWeather).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "jp-0-0", mode: "clear" })]),
    );
    expect(setDetailedWeather).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: expect.stringMatching(/^detail-/u) })]),
      { west: 135, south: 34, east: 136, north: 35 },
    );
    expect(listeners.has("moveend")).toBe(true);
    controller.dispose();
    expect(layer.dispose).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
