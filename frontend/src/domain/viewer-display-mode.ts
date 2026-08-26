export type ViewerDisplayMode = "digital-twin" | "simulation";

export interface ViewerDisplayModeState {
  mode: ViewerDisplayMode;
  congestionEnabled: boolean;
  simulationControlsEnabled: boolean;
}

export function resolveViewerDisplayMode(
  realtimeAvailable: boolean,
  digitalTwinRequested: boolean,
): ViewerDisplayModeState {
  const digitalTwinEnabled = realtimeAvailable && digitalTwinRequested;
  return {
    mode: digitalTwinEnabled ? "digital-twin" : "simulation",
    congestionEnabled: digitalTwinEnabled,
    simulationControlsEnabled: !digitalTwinEnabled,
  };
}
