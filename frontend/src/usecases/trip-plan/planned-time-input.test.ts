import { expect, it } from "vitest";
import { plannedTimeInput } from "./planned-time-input";
it("uses the authored timezone and rejects DST holes/ambiguity unless an explicit valid offset is provided", () => {
  expect(plannedTimeInput("2026-10-05", "15:00", "Asia/Tokyo")).toEqual({ at: "2026-10-05T15:00:00+09:00", timeZone: "Asia/Tokyo" });
  expect(() => plannedTimeInput("2026-03-08", "02:30", "America/New_York")).toThrow();
  expect(() => plannedTimeInput("2026-11-01", "01:30", "America/New_York")).toThrow();
  expect(plannedTimeInput("2026-11-01", "01:30", "America/New_York", "-05:00").at).toContain("-05:00");
  expect(() => plannedTimeInput("2026-10-05", "15:00", "Asia/Tokyo", "+08:00")).toThrow();
});
