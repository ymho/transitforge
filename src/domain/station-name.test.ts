import { describe, expect, it } from "vitest";

import { formatStationLabel, normalizeStationName } from "./station-name";

describe("station name", () => {
  it("normalizes width whitespace suffix and common spelling variants", () => {
    expect(normalizeStationName("  西　大路駅 ")).toBe("西大路");
    expect(normalizeStationName("関ケ原")).toBe(normalizeStationName("関ヶ原駅"));
  });

  it("adds a station suffix only once for display", () => {
    expect(formatStationLabel("西大路")).toBe("西大路駅");
    expect(formatStationLabel("西大路駅")).toBe("西大路駅");
  });
});
