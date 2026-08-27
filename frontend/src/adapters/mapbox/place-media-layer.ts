import mapboxgl from "mapbox-gl";
import type { PlaceMedia } from "@raiquora/trip/place-media";

const sourceId = "verified-travel-places";
const placesByMap = new WeakMap<mapboxgl.Map, Map<string, PlaceMedia>>();

export function showVerifiedPlaces(
  map: mapboxgl.Map,
  places: readonly PlaceMedia[],
  consult: (place: PlaceMedia) => void,
): void {
  const valid = places.filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
  placesByMap.set(map, new Map(valid.map((place) => [place.providerPlaceId, place])));
  const data = { type: "FeatureCollection" as const, features: valid.map((place) => ({
    type: "Feature" as const, id: place.providerPlaceId,
    geometry: { type: "Point" as const, coordinates: [place.longitude!, place.latitude!] },
    properties: { providerPlaceId: place.providerPlaceId, name: place.name },
  })) };
  const source = map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
  if (source) source.setData(data);
  else {
    map.addSource(sourceId, { type: "geojson", data, cluster: true, clusterRadius: 42 });
    map.addLayer({ id: `${sourceId}-clusters`, type: "circle", source: sourceId, filter: ["has", "point_count"], paint: { "circle-color": "#2589ff", "circle-radius": ["step", ["get", "point_count"], 18, 10, 24], "circle-stroke-color": "rgba(255,255,255,.8)", "circle-stroke-width": 2 } });
    map.addLayer({ id: `${sourceId}-points`, type: "circle", source: sourceId, filter: ["!", ["has", "point_count"]], paint: { "circle-color": "#2589ff", "circle-radius": 8, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.on("click", `${sourceId}-points`, (event) => {
      const id = event.features?.[0]?.properties?.providerPlaceId;
      const place = typeof id === "string" ? placesByMap.get(map)?.get(id) : undefined;
      if (!place) return;
      new mapboxgl.Popup({ closeButton: true, maxWidth: "280px" }).setLngLat([place.longitude!, place.latitude!]).setDOMContent(placePopup(place, consult)).addTo(map);
    });
    map.on("mouseenter", `${sourceId}-points`, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", `${sourceId}-points`, () => { map.getCanvas().style.cursor = ""; });
    map.on("click", `${sourceId}-clusters`, (event) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (typeof clusterId !== "number" || feature?.geometry.type !== "Point") return;
      const center = feature.geometry.coordinates as [number, number];
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (error, zoom) => {
        if (!error && zoom !== null) map.easeTo({ center, zoom });
      });
    });
  }
  if (valid.length > 0) {
    const bounds = valid.reduce((current, place) => current.extend([place.longitude!, place.latitude!]), new mapboxgl.LngLatBounds([valid[0]!.longitude!, valid[0]!.latitude!], [valid[0]!.longitude!, valid[0]!.latitude!]));
    map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 700 });
  }
}

function placePopup(place: PlaceMedia, consult: (place: PlaceMedia) => void): HTMLElement {
  const card = document.createElement("article"); card.className = "map-place-card";
  if (place.image?.hotlinkAllowed) { const image = document.createElement("img"); image.src = place.image.url; image.alt = place.name; image.loading = "lazy"; card.append(image); }
  const name = document.createElement("strong"); name.textContent = place.name; card.append(name);
  if (place.summary) { const summary = document.createElement("p"); summary.textContent = place.summary; card.append(summary); }
  const action = document.createElement("button"); action.type = "button"; action.textContent = "ここへ行く相談"; action.addEventListener("click", () => consult(place)); card.append(action);
  const attribution = document.createElement("small"); attribution.textContent = place.image?.attribution ?? "Wikipedia contributors"; card.append(attribution);
  return card;
}
