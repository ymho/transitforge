import { describe, expect, it } from "vitest";

import { parseTrainDelays } from "./train-delay";

describe("train delay data", () => {
  it("indexes non-negative delays by train number", () => {
    const result = parseTrainDelays({
      collectedAt: "2026-07-31T08:36:00+00:00",
      failedSources: ["sanin2"],
      trains: {
        "100A": { delayMinutes: 4 },
        "200B": { delayMinutes: 0 },
        invalid: { delayMinutes: -1 },
      },
    });

    expect(result.failedSources).toEqual(["sanin2"]);
    expect(result.byTrainNumber.get("100A")).toBe(4);
    expect(result.byTrainNumber.get("200B")).toBe(0);
    expect(result.byTrainNumber.has("invalid")).toBe(false);
  });

  it("rejects unexpected snapshots", () => {
    expect(() => parseTrainDelays({ trains: [] })).toThrow("形式が不正");
  });
});
