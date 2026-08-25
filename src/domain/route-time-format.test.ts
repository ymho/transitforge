import { describe, expect, it } from "vitest";

import {
  formatJapaneseRouteClockTime,
  formatJapaneseServiceTime,
  formatRouteClockTime,
  formatServiceTime,
} from "./route-time-format";

describe("route time format", () => {
  it("distinguishes clock time from service-day time", () => {
    expect(formatRouteClockTime(0)).toBe("00:00");
    expect(formatRouteClockTime(240)).toBe("04:00");
    expect(formatRouteClockTime(1_460)).toBe("00:20");
    expect(formatServiceTime(1_460)).toBe("24:20");
  });

  it("rounds fractional minutes consistently", () => {
    expect(formatRouteClockTime(600.5)).toBe("10:01");
    expect(formatJapaneseRouteClockTime(1_460)).toBe("0時20分");
    expect(formatJapaneseServiceTime(1_460.5)).toBe("24時20分30秒");
  });
});
