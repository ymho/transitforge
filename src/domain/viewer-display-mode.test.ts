import { describe, expect, it } from "vitest";

import { resolveViewerDisplayMode } from "./viewer-display-mode";

describe("viewer display mode", () => {
  it("uses digital twin mode when current realtime data is available", () => {
    expect(resolveViewerDisplayMode(true, true)).toEqual({
      mode: "digital-twin",
      realtimeVisualizationsEnabled: true,
    });
  });

  it("uses timetable mode when the user turns digital twin mode off", () => {
    expect(resolveViewerDisplayMode(true, false)).toEqual({
      mode: "timetable",
      realtimeVisualizationsEnabled: false,
    });
  });

  it("falls back to timetable mode when realtime data is unavailable", () => {
    expect(resolveViewerDisplayMode(false, true)).toEqual({
      mode: "timetable",
      realtimeVisualizationsEnabled: false,
    });
  });
});
