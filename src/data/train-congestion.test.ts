import { describe, expect, it } from "vitest";

import {
  congestionBarColor,
  congestionBarHeightMeters,
  congestionRefreshIntervalMilliseconds,
  congestionRetryIntervalMilliseconds,
  parseTrainCongestion,
} from "./train-congestion";

describe("train congestion", () => {
  it("totals valid car values across coupled consists", () => {
    const snapshot = parseTrainCongestion({
      update: "2026-07-28T15:04:12.504Z",
      trains: {
        "1237C": [
          { cars: [{ congestion: 0 }, { congestion: 16 }, { congestion: -1 }] },
          { cars: [{ congestion: 2 }, { congestion: 6 }] },
        ],
      },
    });

    expect(snapshot.updatedAt).toBe("2026-07-28T15:04:12.504Z");
    expect(snapshot.byTrainNumber.get("1237C")).toBe(24);
  });

  it("skips train entries without valid congestion values", () => {
    const snapshot = parseTrainCongestion({
      update: "2026-07-28T15:04:12.504Z",
      trains: {
        "1237C": [{ cars: [{ congestion: -1 }, {}] }],
        broken: "invalid",
      },
    });

    expect(snapshot.byTrainNumber.size).toBe(0);
  });

  it("scales and colors congestion bars within a bounded range", () => {
    expect(congestionBarHeightMeters(0)).toBe(0);
    expect(congestionBarHeightMeters(100)).toBe(10);
    expect(congestionBarHeightMeters(400)).toBe(40);
    expect(congestionBarHeightMeters(1_000)).toBe(100);
    expect(congestionBarColor(10)).toBe("#38b56b");
    expect(congestionBarColor(300)).toBe("#38b56b");
    expect(congestionBarColor(301)).toBe("#f0c94d");
    expect(congestionBarColor(600)).toBe("#f0c94d");
    expect(congestionBarColor(601)).toBe("#df4851");
    expect(congestionBarColor(900)).toBe("#df4851");
    expect(congestionBarColor(901)).toBe("#6d3fb3");
  });

  it("uses conservative refresh and retry intervals", () => {
    expect(congestionRefreshIntervalMilliseconds).toBeGreaterThanOrEqual(
      5 * 60 * 1_000,
    );
    expect(congestionRetryIntervalMilliseconds).toBeGreaterThan(
      congestionRefreshIntervalMilliseconds,
    );
  });
});
