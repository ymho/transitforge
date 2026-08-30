import { describe, expect, it } from "vitest";

import { searchWeatherGridPreview } from "./weather-grid-preview";

describe("searchWeatherGridPreview", () => {
  it("changes weather over short east-west movements around Osaka", async () => {
    const result = await searchWeatherGridPreview({ points: [
      { id: "west", latitude: 34.7, longitude: 135.485 },
      { id: "center", latitude: 34.7, longitude: 135.495 },
      { id: "east", latitude: 34.7, longitude: 135.505 },
    ] });

    expect(result.weatherGrid.data?.cells.map(({ mode }) => mode)).toEqual([
      "clear",
      "cloudy",
      "rain",
    ]);
  });
});
