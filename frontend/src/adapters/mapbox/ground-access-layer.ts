import type { GeoJSONSource, Map as MapboxMap } from "mapbox-gl";
import type { GroundAccessArea, GroundAccessMatrix, GroundAccessRoute } from "@raiquora/trip/ground-access";

const sourceId = "agent-ground-access";
const fillLayerId = "agent-ground-access-fill";
const lineLayerId = "agent-ground-access-line";

export interface GroundAccessLayerController {
  show(data: GroundAccessRoute | GroundAccessMatrix | GroundAccessArea): void;
  clear(): void;
}

type GeoJsonData = Parameters<GeoJSONSource["setData"]>[0];

export function createGroundAccessLayer(map: MapboxMap): GroundAccessLayerController {
  const ensure = () => {
    if (!map.getSource(sourceId)) map.addSource(sourceId, { type: "geojson", data: emptyCollection() });
    if (!map.getLayer(fillLayerId)) map.addLayer({ id: fillLayerId, type: "fill", source: sourceId, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#2f8ff7", "fill-opacity": 0.14 } });
    if (!map.getLayer(lineLayerId)) map.addLayer({ id: lineLayerId, type: "line", source: sourceId, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#1677d2", "line-width": 5, "line-opacity": 0.82 } });
  };
  const set = (data: GeoJsonData) => {
    ensure();
    (map.getSource(sourceId) as GeoJSONSource).setData(data);
  };
  return {
    show(data) {
      if ("geometry" in data) {
        set({ type: "FeatureCollection", features: [{ type: "Feature", properties: { kind: "route" }, geometry: { type: "LineString", coordinates: data.geometry.map((point) => [point.longitude, point.latitude]) } }] });
      } else if ("polygons" in data) {
        set({ type: "FeatureCollection", features: data.polygons.map((ring) => ({ type: "Feature", properties: { kind: "isochrone", minutes: data.minutes }, geometry: { type: "Polygon", coordinates: [ring.map((point) => [point.longitude, point.latitude])] } })) });
      } else set(emptyCollection());
    },
    clear() { if (map.getSource(sourceId)) set(emptyCollection()); },
  };
}

function emptyCollection(): GeoJsonData { return { type: "FeatureCollection", features: [] }; }
