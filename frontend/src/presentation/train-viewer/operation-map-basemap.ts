export const operationBasemapConfig = {
  theme: "faded",
  show3dObjects: true,
  showPointOfInterestLabels: false,
  showPlaceLabels: false,
  showRoadLabels: false,
  showTransitLabels: false,
  showLandmarkIcons: false,
  showLandmarkIconLabels: false,
} as const;

export interface OperationBasemapTarget {
  setConfigProperty(importId: string, configName: string, value: string | boolean): unknown;
}

/** Reapply the exact operation-screen policy after Mapbox Standard reloads its style. */
export function applyOperationBasemapConfig(map: OperationBasemapTarget): void {
  for (const [name, value] of Object.entries(operationBasemapConfig)) {
    map.setConfigProperty("basemap", name, value);
  }
}
