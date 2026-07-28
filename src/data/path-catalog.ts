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

export async function loadPathCatalog(): Promise<PathCatalog> {
  const response = await fetch("/viewer-input/path_catalog.json");

  if (!response.ok) {
    throw new Error(`経路カタログを読み込めませんでした (${response.status})。`);
  }

  const catalog: unknown = await response.json();

  if (!isPathCatalog(catalog)) {
    throw new Error("経路カタログの形式またはスキーマバージョンが不正です。");
  }

  return catalog;
}

export function toRouteFeatureCollection(
  catalog: PathCatalog,
  lineColorsByPathId?: ReadonlyMap<string, string>,
): RouteFeatureCollection {
  return toRouteFeatureCollectionForPaths(catalog.paths, lineColorsByPathId);
}

export function toRouteFeatureCollections(
  catalog: PathCatalog,
  pathsPerCollection = 64,
  lineColorsByPathId?: ReadonlyMap<string, string>,
): RouteFeatureCollection[] {
  if (!Number.isInteger(pathsPerCollection) || pathsPerCollection < 1) {
    throw new Error("経路チャンクの件数は1以上の整数である必要があります。");
  }

  const collections: RouteFeatureCollection[] = [];

  for (let index = 0; index < catalog.paths.length; index += pathsPerCollection) {
    collections.push(
      toRouteFeatureCollectionForPaths(
        catalog.paths.slice(index, index + pathsPerCollection),
        lineColorsByPathId,
      ),
    );
  }

  return collections;
}

function toRouteFeatureCollectionForPaths(
  paths: Path[],
  lineColorsByPathId?: ReadonlyMap<string, string>,
): RouteFeatureCollection {
  return {
    type: "FeatureCollection",
    features: paths.map((path) => ({
      type: "Feature",
      properties: {
        path_id: path.path_id,
        ...(lineColorsByPathId?.has(path.path_id)
          ? { line_color: lineColorsByPathId.get(path.path_id) }
          : {}),
      },
      geometry: { type: "LineString", coordinates: path.route_coords },
    })),
  };
}

export function overallBounds(catalog: PathCatalog): BoundingBox {
  return catalog.paths.reduce<BoundingBox | undefined>((bounds, path) => {
    const [minLongitude, minLatitude, maxLongitude, maxLatitude] = path.bbox;

    if (!bounds) {
      return [minLongitude, minLatitude, maxLongitude, maxLatitude];
    }

    return [
      Math.min(bounds[0], minLongitude),
      Math.min(bounds[1], minLatitude),
      Math.max(bounds[2], maxLongitude),
      Math.max(bounds[3], maxLatitude),
    ];
  }, undefined) ?? [0, 0, 0, 0];
}

function isPathCatalog(value: unknown): value is PathCatalog {
  if (!isRecord(value) || value.schema_version !== "train-path-catalog-v1") {
    return false;
  }

  return Array.isArray(value.paths) && value.paths.every(isPath);
}

function isPath(value: unknown): value is Path {
  return (
    isRecord(value) &&
    typeof value.path_id === "string" &&
    typeof value.coord_count === "number" &&
    typeof value.route_length_m === "number" &&
    isBoundingBox(value.bbox) &&
    Array.isArray(value.route_coords) &&
    value.route_coords.every(isCoordinate)
  );
}

function isBoundingBox(value: unknown): value is BoundingBox {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
}

function isCoordinate(value: unknown): value is Coordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
