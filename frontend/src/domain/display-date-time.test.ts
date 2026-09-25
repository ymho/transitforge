import { describe, expect, it } from "vitest";

import {
  dateForOperatingRouteTime,
  displayDateTimeLabels,
  operatingServiceDateStart,
  stepDisplayDateTime,
} from "./display-date-time";

describe("display date and time", () => {
  it("formats a compact Japanese date and clock for the viewer", () => {
    expect(displayDateTimeLabels(new Date("2026-08-13T17:48:09.000Z"))).toEqual({
      date: "2026年8月14日(金)",
      time: "02:48:09",
    });
  });

  it("clamps the day when stepping into a shorter month", () => {
    const result = stepDisplayDateTime(new Date(2024, 0, 31, 12), "month", 1);

    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(29);
  });

  it("carries time steps across calendar boundaries", () => {
    const result = stepDisplayDateTime(
      new Date(2026, 6, 31, 23, 59, 59),
      "second",
      1,
    );

    expect(result.getMonth()).toBe(7);
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it("maps after-midnight route time onto the next calendar date", () => {
    const serviceDate = operatingServiceDateStart(new Date("2026-07-31T14:00:00.000Z"));
    const result = dateForOperatingRouteTime(serviceDate, 24 * 60 + 30);

    expect(displayDateTimeLabels(result)).toMatchObject({ date: "2026年8月1日(土)", time: "00:30:00" });
  });

  it("preserves seconds represented by fractional route minutes", () => {
    const serviceDate = operatingServiceDateStart(new Date("2026-08-01T03:00:00.000Z"));
    const result = dateForOperatingRouteTime(serviceDate, 12 * 60 + 4.5);

    expect(displayDateTimeLabels(result)).toMatchObject({ time: "12:04:30" });
  });

  it("uses the previous Japan calendar day before the 4am operating-day boundary", () => {
    expect(operatingServiceDateStart(new Date("2026-08-01T18:30:00.000Z")).toISOString())
      .toBe("2026-07-31T15:00:00.000Z");
  });
});
