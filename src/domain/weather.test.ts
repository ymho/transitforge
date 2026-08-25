import { describe, expect, it } from "vitest";

import { isWeatherMode } from "./weather";

describe("weather mode", () => {
  it("recognizes only supported values", () => {
    expect(isWeatherMode("snow")).toBe(true);
    expect(isWeatherMode("cloudy")).toBe(true);
    expect(isWeatherMode("storm")).toBe(false);
  });
});
