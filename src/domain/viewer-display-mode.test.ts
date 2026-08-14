import { describe, expect, it } from "vitest";

import { resolveViewerDisplayMode } from "./viewer-display-mode";

describe("viewer display mode", () => {
  it("uses digital twin mode when current realtime data is available", () => {
    expect(resolveViewerDisplayMode(true, true)).toEqual({
      mode: "digital-twin",
      congestionEnabled: true,
      simulationControlsEnabled: false,
    });
  });

  it("uses simulation mode when the user turns digital twin mode off", () => {
    expect(resolveViewerDisplayMode(true, false)).toEqual({
      mode: "simulation",
      congestionEnabled: false,
      simulationControlsEnabled: true,
    });
  });

  it("falls back to simulation mode when realtime data is unavailable", () => {
    expect(resolveViewerDisplayMode(false, true)).toEqual({
      mode: "simulation",
      congestionEnabled: false,
      simulationControlsEnabled: true,
    });
  });
});
