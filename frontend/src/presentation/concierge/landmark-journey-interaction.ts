import type { Map } from "mapbox-gl";

export interface MapLandmarkSelection {
  name: string;
  longitude?: number;
  latitude?: number;
}

export function configureLandmarkJourneyInteraction(
  map: Pick<Map, "addInteraction">,
  openLandmarkDetail: (selection: MapLandmarkSelection) => void,
): void {
  map.addInteraction("transitforge-landmark-journey", {
    type: "click",
    target: { featuresetId: "landmark-icons", importId: "basemap" },
    handler: ({ feature }) => {
      const selection = mapLandmarkSelection(feature);
      if (selection) openLandmarkDetail(selection);
    },
  });
}

export function mapLandmarkSelection(feature: {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
} | undefined): MapLandmarkSelection | undefined {
  const name = feature?.properties
    ? landmarkProperty(feature.properties, "name")
    : undefined;
  if (!name) return undefined;
  const coordinates = feature?.geometry?.type === "Point" &&
    Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : undefined;
  const longitude = coordinates?.[0];
  const latitude = coordinates?.[1];
  return {
    name,
    ...(typeof longitude === "number" && Number.isFinite(longitude) ? { longitude } : {}),
    ...(typeof latitude === "number" && Number.isFinite(latitude) ? { latitude } : {}),
  };
}

function landmarkProperty(
  properties: Record<string, unknown>,
  key: "name",
): string | undefined {
  const value = properties[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
