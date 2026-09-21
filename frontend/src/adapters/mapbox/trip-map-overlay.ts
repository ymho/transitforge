import mapboxgl, { type Map } from "mapbox-gl";

export interface TripMapPoint {
  readonly itemId: string;
  readonly name: string;
  readonly longitude: number;
  readonly latitude: number;
}
export interface TripMapRoute { readonly itemId: string; readonly coordinates: readonly [number, number][]; }

const sourceId = "trip-route-geometry", layerId = "trip-route-geometry-line";

/** One reusable Mapbox overlay. Replacing a Trip removes every previous Marker and listener. */
export function createTripMapOverlay(map: Map, select: (itemId: string) => void) {
  let markers: mapboxgl.Marker[] = [], currentKey = "";
  const removeRoute = () => { if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId); };
  const clear = () => { markers.forEach((marker) => marker.remove()); markers = []; removeRoute(); currentKey = ""; };
  const show = (key: string, points: readonly TripMapPoint[], routes: readonly TripMapRoute[] = [], itemId?: string) => {
    if (key !== currentKey) {
      clear(); currentKey = key;
      markers = points.map((point) => {
        const node = document.createElement("button"); node.type = "button"; node.className = "trip-map-marker";
        node.title = point.name; node.setAttribute("aria-label", `${point.name}を旅程で選択`);
        node.addEventListener("click", () => select(point.itemId));
        return new mapboxgl.Marker({ element: node }).setLngLat([point.longitude, point.latitude]).addTo(map);
      });
      if (routes.length) {
        map.addSource(sourceId, { type: "geojson", data: { type: "FeatureCollection", features: routes.map((route) => ({
          type: "Feature", properties: { itemId: route.itemId }, geometry: { type: "LineString", coordinates: route.coordinates.map((coordinate) => [...coordinate]) },
        })) } });
        map.addLayer({ id: layerId, type: "line", source: sourceId, slot: "top", paint: {
          "line-color": "#246b9e", "line-width": 5, "line-opacity": .88,
        } });
      }
    }
    const chosen = itemId ? points.find((point) => point.itemId === itemId) : undefined;
    const routeCoordinates = routes.filter((route) => !itemId || route.itemId === itemId).flatMap((route) => route.coordinates);
    if (chosen) map.easeTo({ center: [chosen.longitude, chosen.latitude], zoom: Math.max(map.getZoom(), 13) });
    else if (points.length === 1) map.easeTo({ center: [points[0]!.longitude, points[0]!.latitude], zoom: Math.max(map.getZoom(), 12) });
    else if (points.length > 1 || routeCoordinates.length) {
      const coordinates: [number, number][] = routeCoordinates.length ? [...routeCoordinates] : points.map((point) => [point.longitude, point.latitude]);
      const bounds = coordinates.slice(1).reduce((value, coordinate) => value.extend(coordinate),
        new mapboxgl.LngLatBounds(coordinates[0]!, coordinates[0]!));
      map.fitBounds(bounds, { padding: 72, maxZoom: 13 });
    }
  };
  return { show, clear, destroy: clear };
}

export type TripMapOverlay = ReturnType<typeof createTripMapOverlay>;
