import type { Map } from "mapbox-gl";

export function configureLandmarkJourneyInteraction(
  map: Pick<Map, "addInteraction">,
  openLandmarkJourney: (name: string, type?: string) => void,
): void {
  map.addInteraction("transitforge-landmark-journey", {
    type: "click",
    target: { featuresetId: "landmark-icons", importId: "basemap" },
    handler: ({ feature }) => {
      const properties = feature?.properties;
      if (!properties) return;
      const name = landmarkProperty(properties, "name");
      if (!name) return;
      openLandmarkJourney(name);
    },
  });
}

function landmarkProperty(
  properties: Record<string, unknown>,
  key: "name",
): string | undefined {
  const value = properties[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
