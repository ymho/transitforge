import { describe, expect, it } from "vitest";

import type { StationLineCatalog } from "./station-line-catalog";

describe("station line catalog contract", () => {
  it("represents a station on more than one line without duplicating colors", () => {
    const catalog: StationLineCatalog = {
      schema_version: "station-line-catalog-v1",
      source: "N02-25_Station.geojson",
      lines: [
        {
          operator: "西日本旅客鉄道",
          line: "東海道線",
          stations: [{ name: "京都", coordinate: [135.758, 34.986] }],
        },
        {
          operator: "西日本旅客鉄道",
          line: "奈良線",
          stations: [{ name: "京都", coordinate: [135.759, 34.985] }],
        },
      ],
    };

    expect(catalog.lines.filter(({ stations }) => stations[0]?.name === "京都")).toHaveLength(2);
  });
});
