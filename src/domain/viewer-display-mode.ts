export type ViewerDisplayMode = "digital-twin" | "timetable";

export interface ViewerDisplayModeState {
  mode: ViewerDisplayMode;
  realtimeVisualizationsEnabled: boolean;
}

export function resolveViewerDisplayMode(
  realtimeAvailable: boolean,
  digitalTwinRequested: boolean,
): ViewerDisplayModeState {
  const digitalTwinEnabled = realtimeAvailable && digitalTwinRequested;
  return {
    mode: digitalTwinEnabled ? "digital-twin" : "timetable",
    realtimeVisualizationsEnabled: digitalTwinEnabled,
  };
}
