import { describe, expect, it } from "vitest";

import {
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

  it("refreshes once per minute and backs off after failures", () => {
    expect(congestionRefreshIntervalMilliseconds).toBe(60 * 1_000);
    expect(congestionRetryIntervalMilliseconds).toBeGreaterThan(
      congestionRefreshIntervalMilliseconds,
    );
  });
});
