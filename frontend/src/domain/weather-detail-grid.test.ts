import { describe, expect, it } from "vitest";

import { weatherDetailGrid } from "./weather-detail-grid";

describe("weatherDetailGrid", () => {
  const bounds = { west: 135, south: 34, east: 136, north: 35 };

  it("uses progressively denser grids as the map zooms in", () => {
    expect(weatherDetailGrid(bounds, 6)).toBeUndefined();
    expect(weatherDetailGrid(bounds, 7)?.points).toHaveLength(4);
    expect(weatherDetailGrid(bounds, 9)?.points).toHaveLength(9);
    expect(weatherDetailGrid(bounds, 11)?.points).toHaveLength(16);
  });

  it("clips detail requests to the supported Japanese area", () => {
    expect(weatherDetailGrid({ west: 120, south: 19, east: 124, north: 22 }, 10))
      .toMatchObject({ bounds: { west: 122, south: 20, east: 124, north: 22 } });
    expect(weatherDetailGrid({ west: 10, south: 40, east: 11, north: 41 }, 10))
      .toBeUndefined();
  });
});
