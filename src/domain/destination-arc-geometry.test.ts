import { describe, expect, it } from "vitest";
import {
  destinationArcHeightMeters,
  destinationArcVertex,
} from "./destination-arc-geometry";

describe("destination arc geometry", () => {
  it("caps arc height and keeps endpoints above the map", () => {
    expect(destinationArcHeightMeters(100_000)).toBe(16_000);
    expect(destinationArcHeightMeters(1_000_000)).toBe(30_000);
    const start = destinationArcVertex(
      { x: 10, y: 20 },
      { x: 14, y: 24 },
      0,
      0.5,
      16_000,
      { x: 9, y: 19 },
    );
    expect(start).toEqual({ x: 1, y: -1, z: 4 });
  });

  it("places the midpoint at the top of the arc", () => {
    expect(
      destinationArcVertex(
        { x: 10, y: 20 },
        { x: 14, y: 24 },
        0.5,
        0.001,
        1_000,
        { x: 9, y: 19 },
      ),
    ).toEqual({ x: 3, y: -3, z: 1.008 });
  });
});
