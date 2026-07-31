import { describe, expect, it } from "vitest";

import { parseViewerAgentActions } from "./viewer-agent-action";

describe("viewer agent action", () => {
  it("accepts the reversible viewer actions exposed to the agent", () => {
    expect(
      parseViewerAgentActions([
        { type: "set_display_time", routeTimeMinutes: 1_080 },
        { type: "focus_train", serviceUid: "service-a" },
        { type: "set_weather", weather: "cloudy" },
        { type: "set_scene_mode", sceneMode: "model" },
        {
          type: "set_layer_visibility",
          layer: "destination_arcs",
          visible: true,
        },
      ]),
    ).toEqual([
      { type: "set_display_time", routeTimeMinutes: 1_080 },
      { type: "focus_train", serviceUid: "service-a" },
      { type: "set_weather", weather: "cloudy" },
      { type: "set_scene_mode", sceneMode: "model" },
      {
        type: "set_layer_visibility",
        layer: "destination_arcs",
        visible: true,
      },
    ]);
  });

  it("rejects unknown, incomplete, and unsafe actions", () => {
    expect(() => parseViewerAgentActions({})).toThrow("配列");
    expect(() =>
      parseViewerAgentActions([{ type: "set_display_time", routeTimeMinutes: -1 }]),
    ).toThrow("1 件目");
    expect(() =>
      parseViewerAgentActions([{ type: "delete_train", serviceUid: "service-a" }]),
    ).toThrow("1 件目");
  });
});
