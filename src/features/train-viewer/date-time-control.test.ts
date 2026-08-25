import { describe, expect, it } from "vitest";

import { formatDateTimeLocal, maximumRouteTimeFor } from "./date-time-control";

describe("date time control", () => {
  it("日時入力へローカル日時を秒まで整形する", () => {
    expect(formatDateTimeLocal(new Date(2026, 7, 25, 9, 4, 7))).toBe(
      "2026-08-25T09:04:07",
    );
  });

  it("全列車の最大経路時刻を求める", () => {
    expect(maximumRouteTimeFor([
      { stops: [{ route_time_minutes: 120 }, { route_time_minutes: 1_620 }] },
      { stops: [{ route_time_minutes: 1_500 }] },
    ])).toBe(1_620);
  });
});
