import mapboxgl from "mapbox-gl";
import type { PlaceMedia } from "@raiquora/trip/place-media";

const sourceId = "verified-travel-places";
const clusterLayerId = `${sourceId}-clusters`;
const pointLayerId = `${sourceId}-points`;
const placeCameraPitch = 52;
const placeCameraBearing = -18;

export interface VerifiedPlaceLayerController {
  show(places: readonly PlaceMedia[]): void;
  focus(providerPlaceId: string): void;
  clear(): void;
}

/** 検証済みの外部スポットだけをMapboxへ渡すAdapter */
export function createVerifiedPlaceLayer(
  map: mapboxgl.Map,
  onSelected: (place: PlaceMedia) => void,
): VerifiedPlaceLayerController {
  let placesById = new Map<string, PlaceMedia>();
  let selectedId: string | undefined;
  let handlersAttached = false;

  const ensureLayer = () => {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data: featureCollection([]), cluster: true, clusterRadius: 42 });
    }
    if (!map.getLayer(clusterLayerId)) {
      map.addLayer({ id: clusterLayerId, type: "circle", source: sourceId, filter: ["has", "point_count"], paint: {
        "circle-color": "#2589ff",
        "circle-radius": ["step", ["get", "point_count"], 18, 10, 24],
        "circle-stroke-color": "rgba(255,255,255,.8)",
        "circle-stroke-width": 2,
      } });
    }
    if (!map.getLayer(pointLayerId)) {
      map.addLayer({ id: pointLayerId, type: "circle", source: sourceId, filter: ["!", ["has", "point_count"]], paint: {
        "circle-color": ["case", ["boolean", ["feature-state", "selected"], false], "#ffffff", "#2589ff"],
        "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 12, 8],
        "circle-stroke-color": ["case", ["boolean", ["feature-state", "selected"], false], "#2589ff", "#ffffff"],
        "circle-stroke-width": 3,
      } });
    }
    if (handlersAttached) return;
    handlersAttached = true;
    map.on("click", pointLayerId, (event) => {
      const id = event.features?.[0]?.properties?.providerPlaceId;
      const place = typeof id === "string" ? placesById.get(id) : undefined;
      if (!place) return;
      select(id, false);
      onSelected(place);
    });
    map.on("mouseenter", pointLayerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", pointLayerId, () => { map.getCanvas().style.cursor = ""; });
    map.on("click", clusterLayerId, (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (typeof clusterId !== "number" || feature?.geometry.type !== "Point") return;
      const center = feature.geometry.coordinates as [number, number];
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (!error && zoom !== null) map.easeTo({ center, zoom });
      });
    });
  };

  const select = (providerPlaceId: string, moveMap: boolean) => {
    const place = placesById.get(providerPlaceId);
    if (!place || place.longitude === undefined || place.latitude === undefined) return;
    if (selectedId) map.setFeatureState({ source: sourceId, id: selectedId }, { selected: false });
    selectedId = providerPlaceId;
    map.setFeatureState({ source: sourceId, id: providerPlaceId }, { selected: true });
    if (moveMap) {
      map.easeTo({
        center: [place.longitude, place.latitude],
        zoom: Math.max(map.getZoom(), 14),
        pitch: placeCameraPitch,
        bearing: placeCameraBearing,
        duration: 700,
      });
    }
  };

  return {
    show(places) {
      const valid = places.filter(hasCoordinates);
      placesById = new Map(valid.map((place) => [place.providerPlaceId, place]));
      selectedId = undefined;
      ensureLayer();
      setBasemapLandmarksVisible(map, valid.length === 0);
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(featureCollection(valid));
      if (valid.length === 0) return;
      const first = valid[0]!;
      const bounds = valid.reduce(
        (current, place) => current.extend([place.longitude!, place.latitude!]),
        new mapboxgl.LngLatBounds([first.longitude!, first.latitude!], [first.longitude!, first.latitude!]),
      );
      map.fitBounds(bounds, {
        padding: 80,
        maxZoom: 13,
        pitch: placeCameraPitch,
        bearing: placeCameraBearing,
        duration: 700,
      });
    },
    focus(providerPlaceId) { select(providerPlaceId, true); },
    clear() {
      placesById.clear();
      selectedId = undefined;
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined)?.setData(featureCollection([]));
      setBasemapLandmarksVisible(map, true);
    },
  };
}

function setBasemapLandmarksVisible(map: mapboxgl.Map, visible: boolean): void {
  map.setConfigProperty("basemap", "showLandmarkIcons", visible);
  map.setConfigProperty("basemap", "showLandmarkIconLabels", visible);
}

function hasCoordinates(place: PlaceMedia): boolean {
  return Number.isFinite(place.latitude) && Number.isFinite(place.longitude);
}

function featureCollection(places: readonly PlaceMedia[]) {
  return { type: "FeatureCollection" as const, features: places.map((place) => ({
    type: "Feature" as const,
    id: place.providerPlaceId,
    geometry: { type: "Point" as const, coordinates: [place.longitude!, place.latitude!] },
    properties: { providerPlaceId: place.providerPlaceId, name: place.name },
  })) };
}
