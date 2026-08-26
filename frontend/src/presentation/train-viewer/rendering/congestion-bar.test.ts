import { describe, expect, it } from "vitest";

import { congestionBarColor, congestionBarHeightMeters } from "./congestion-bar";

describe("congestion bar", () => {
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
});
