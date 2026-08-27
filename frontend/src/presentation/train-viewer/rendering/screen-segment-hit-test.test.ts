import { describe, expect, it } from "vitest";
import { distanceToScreenSegment } from "./screen-segment-hit-test";

describe("distanceToScreenSegment", () => {
  it("measures a pointer against the visible bar segment", () => {
    expect(distanceToScreenSegment({ x: 13, y: 50 }, { x: 10, y: 90 }, { x: 10, y: 20 })).toBe(3);
  });

  it("uses the nearest endpoint outside the segment", () => {
    expect(distanceToScreenSegment({ x: 10, y: 5 }, { x: 10, y: 90 }, { x: 10, y: 20 })).toBe(15);
  });
});
