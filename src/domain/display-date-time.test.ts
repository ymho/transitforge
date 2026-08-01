import { describe, expect, it } from "vitest";

import {
  dateForOperatingRouteTime,
  operatingServiceDateStart,
  stepDisplayDateTime,
} from "./display-date-time";

describe("display date and time", () => {
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
    const serviceDate = operatingServiceDateStart(new Date(2026, 6, 31, 23));
    const result = dateForOperatingRouteTime(serviceDate, 24 * 60 + 30);

    expect(result.getMonth()).toBe(7);
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(30);
  });

  it("preserves seconds represented by fractional route minutes", () => {
    const serviceDate = operatingServiceDateStart(new Date(2026, 7, 1, 12));
    const result = dateForOperatingRouteTime(serviceDate, 12 * 60 + 4.5);

    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(4);
    expect(result.getSeconds()).toBe(30);
  });
});
