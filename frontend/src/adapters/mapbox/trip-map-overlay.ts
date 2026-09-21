import mapboxgl, { type Map } from "mapbox-gl";

export interface TripMapPoint {
  readonly itemId: string;
  readonly name: string;
  readonly longitude: number;
  readonly latitude: number;
}

/** One reusable Mapbox overlay. Replacing a Trip removes every previous Marker and listener. */
export function createTripMapOverlay(map: Map, select: (itemId: string) => void) {
  let markers: mapboxgl.Marker[] = [], currentKey = "";
  const clear = () => { markers.forEach((marker) => marker.remove()); markers = []; currentKey = ""; };
  const show = (key: string, points: readonly TripMapPoint[], itemId?: string) => {
    if (key !== currentKey) {
      clear(); currentKey = key;
      markers = points.map((point) => {
        const node = document.createElement("button"); node.type = "button"; node.className = "trip-map-marker";
        node.title = point.name; node.setAttribute("aria-label", `${point.name}を旅程で選択`);
        node.addEventListener("click", () => select(point.itemId));
        return new mapboxgl.Marker({ element: node }).setLngLat([point.longitude, point.latitude]).addTo(map);
      });
    }
    const chosen = itemId ? points.find((point) => point.itemId === itemId) : undefined;
    if (chosen) map.easeTo({ center: [chosen.longitude, chosen.latitude], zoom: Math.max(map.getZoom(), 13) });
    else if (points.length === 1) map.easeTo({ center: [points[0]!.longitude, points[0]!.latitude], zoom: Math.max(map.getZoom(), 12) });
    else if (points.length > 1) {
      const bounds = points.slice(1).reduce((value, point) => value.extend([point.longitude, point.latitude]),
        new mapboxgl.LngLatBounds([points[0]!.longitude, points[0]!.latitude], [points[0]!.longitude, points[0]!.latitude]));
      map.fitBounds(bounds, { padding: 72, maxZoom: 13 });
    }
  };
  return { show, clear, destroy: clear };
}

export type TripMapOverlay = ReturnType<typeof createTripMapOverlay>;
