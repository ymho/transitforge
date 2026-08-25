export type Coordinate = [longitude: number, latitude: number];
export type BoundingBox = [
  minimumLongitude: number,
  minimumLatitude: number,
  maximumLongitude: number,
  maximumLatitude: number,
];

export interface Path {
  path_id: string;
  coord_count: number;
  route_length_m: number;
  bbox: BoundingBox;
  route_coords: Coordinate[];
}

export interface PathCatalog {
  schema_version: "train-path-catalog-v1";
  paths: Path[];
}

export interface RouteFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { path_id: string; line_color?: string };
    geometry: { type: "LineString"; coordinates: Coordinate[] };
  }>;
}
