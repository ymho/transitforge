import { describe, expect, it, vi } from "vitest";

import { createWeatherGridOperation } from "./weather-grid.js";

describe("weather grid operation", () => {
  it("validates and forwards unique points in the supported Japanese area", async () => {
    const searchGrid = vi.fn(async () => ({
      status: "available" as const,
      freshness: "fresh" as const,
      data: { cells: [] },
      evidence: [],
    }));
    const operation = createWeatherGridOperation({ searchGrid });

    const result = await operation({
      points: [{ id: "center", latitude: 34.7, longitude: 135.5 }],
    }, { requestId: "request-1" });

    expect(result.statusCode).toBeUndefined();
    expect(searchGrid).toHaveBeenCalledWith({
      points: [{ id: "center", latitude: 34.7, longitude: 135.5 }],
    });
  });

  it("rejects duplicate cell identifiers", async () => {
    const operation = createWeatherGridOperation({ searchGrid: vi.fn() });
    const result = await operation({ points: [
      { id: "same", latitude: 34.7, longitude: 135.5 },
      { id: "same", latitude: 35, longitude: 136 },
    ] }, { requestId: "request-1" });
    expect(result.statusCode).toBe(400);
  });

  it("rejects points outside the supported Japanese region", async () => {
    const searchGrid = vi.fn();
    const operation = createWeatherGridOperation({ searchGrid });
    const result = await operation({
      points: [{ id: "hong-kong", latitude: 22.3, longitude: 114.2 }],
    }, { requestId: "request-1" });

    expect(result.statusCode).toBe(400);
    expect(searchGrid).not.toHaveBeenCalled();
  });
});
