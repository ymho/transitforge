import { describe, expect, it } from "vitest";

import { mapLandmarkSelection } from "./landmark-journey-interaction";

describe("map landmark journey interaction", () => {
  it("keeps the landmark coordinate so the map can show its 3D structure", () => {
    expect(mapLandmarkSelection({
      properties: { name: "美山かやぶきの里" },
      geometry: { type: "Point", coordinates: [135.622, 35.312] },
    })).toEqual({
      name: "美山かやぶきの里",
      longitude: 135.622,
      latitude: 35.312,
    });
  });

  it("does not open an unnamed landmark", () => {
    expect(mapLandmarkSelection({
      properties: {},
      geometry: { type: "Point", coordinates: [135.622, 35.312] },
    })).toBeUndefined();
  });
});
