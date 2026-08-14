import { describe, expect, it } from "vitest";

import { parseTrainDelays } from "./train-delay";

describe("train delay data", () => {
  it("indexes non-negative delays by train number", () => {
    const result = parseTrainDelays({
      collectedAt: "2026-07-31T08:36:00+00:00",
      failedSources: ["sanin2"],
      trains: {
        "100A": { delayMinutes: 4, destination: " 姫路 " },
        "200B": { delayMinutes: 0, destination: "京都" },
        invalid: { delayMinutes: -1, destination: "大阪" },
        missingDestination: { delayMinutes: 2 },
      },
    });

    expect(result.failedSources).toEqual(["sanin2"]);
    expect(result.operationsByTrainNumber.get("100A")).toEqual({
      delayMinutes: 4,
      destination: "姫路",
    });
    expect(result.operationsByTrainNumber.get("200B")).toEqual({
      delayMinutes: 0,
      destination: "京都",
    });
    expect(result.operationsByTrainNumber.has("invalid")).toBe(false);
    expect(result.operationsByTrainNumber.has("missingDestination")).toBe(false);
  });

  it("rejects unexpected snapshots", () => {
    expect(() => parseTrainDelays({ trains: [] })).toThrow("形式が不正");
    expect(() =>
      parseTrainDelays({
        collectedAt: "unknown",
        failedSources: [],
        trains: {},
      }),
    ).toThrow("収集日時が不正");
  });
});
