import type { SceneMode } from "./map-scene-mode";
import type { WeatherMode } from "./map-weather";

export type ViewerAgentLayer = "congestion" | "destination_arcs";

export type ViewerAgentAction =
  | {
      type: "set_display_time";
      routeTimeMinutes: number;
    }
  | {
      type: "focus_train";
      serviceUid: string;
    }
  | {
      type: "set_weather";
      weather: WeatherMode;
    }
  | {
      type: "set_scene_mode";
      sceneMode: SceneMode;
    }
  | {
      type: "set_layer_visibility";
      layer: ViewerAgentLayer;
      visible: boolean;
    };

export function parseViewerAgentActions(value: unknown): ViewerAgentAction[] {
  if (!Array.isArray(value)) {
    throw new Error("AIの画面操作は配列である必要があります。");
  }

  return value.map((action, index) => {
    if (!isRecord(action) || typeof action.type !== "string") {
      throw invalidAction(index);
    }

    switch (action.type) {
      case "set_display_time":
        if (
          typeof action.routeTimeMinutes === "number" &&
          Number.isFinite(action.routeTimeMinutes) &&
          action.routeTimeMinutes >= 0
        ) {
          return {
            type: action.type,
            routeTimeMinutes: action.routeTimeMinutes,
          };
        }
        break;
      case "focus_train":
        if (
          typeof action.serviceUid === "string" &&
          action.serviceUid.length > 0
        ) {
          return {
            type: action.type,
            serviceUid: action.serviceUid,
          };
        }
        break;
      case "set_weather":
        if (
          action.weather === "clear" ||
          action.weather === "rain" ||
          action.weather === "snow"
        ) {
          return {
            type: action.type,
            weather: action.weather,
          };
        }
        break;
      case "set_scene_mode":
        if (action.sceneMode === "normal" || action.sceneMode === "model") {
          return {
            type: action.type,
            sceneMode: action.sceneMode,
          };
        }
        break;
      case "set_layer_visibility":
        if (
          (action.layer === "congestion" ||
            action.layer === "destination_arcs") &&
          typeof action.visible === "boolean"
        ) {
          return {
            type: action.type,
            layer: action.layer,
            visible: action.visible,
          };
        }
        break;
    }

    throw invalidAction(index);
  });
}

function invalidAction(index: number): Error {
  return new Error(`AIの画面操作 ${index + 1} 件目が不正です。`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
