import type { LightPreset } from "./map-lighting";

export type SceneMode = "normal" | "model";

export interface SceneModeStyle {
  theme: "default" | "faded";
  routeLineWidth: number;
  routeLineOpacity: number;
  lightPresetOverride?: LightPreset;
}

export function isSceneMode(value: string | undefined): value is SceneMode {
  return value === "normal" || value === "model";
}

export function sceneModeStyleFor(mode: SceneMode): SceneModeStyle {
  if (mode === "model") {
    return {
      theme: "faded",
      routeLineWidth: 2,
      routeLineOpacity: 0.72,
      lightPresetOverride: "day",
    };
  }

  return {
    theme: "default",
    routeLineWidth: 1.5,
    routeLineOpacity: 0.48,
  };
}

export function lightPresetForSceneMode(
  mode: SceneMode,
  routeTimePreset: LightPreset,
): LightPreset {
  return sceneModeStyleFor(mode).lightPresetOverride ?? routeTimePreset;
}
