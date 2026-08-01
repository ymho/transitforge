export type StationCoordinate = [longitude: number, latitude: number];

export interface StationLineCatalogStation {
  name: string;
  coordinate: StationCoordinate;
}

export interface StationLineCatalogLine {
  operator: string;
  line: string;
  stations: StationLineCatalogStation[];
}

export interface StationLineCatalog {
  schema_version: "station-line-catalog-v1";
  source: string;
  lines: StationLineCatalogLine[];
}

export function isStationLineCatalog(value: unknown): value is StationLineCatalog {
  return (
    isRecord(value) &&
    value.schema_version === "station-line-catalog-v1" &&
    typeof value.source === "string" &&
    Array.isArray(value.lines) &&
    value.lines.every(isStationLineCatalogLine)
  );
}

export function emptyStationLineCatalog(): StationLineCatalog {
  return {
    schema_version: "station-line-catalog-v1",
    source: "unavailable",
    lines: [],
  };
}

function isStationLineCatalogLine(value: unknown): value is StationLineCatalogLine {
  return (
    isRecord(value) &&
    typeof value.operator === "string" &&
    typeof value.line === "string" &&
    Array.isArray(value.stations) &&
    value.stations.every(isStation)
  );
}

function isStation(value: unknown): value is StationLineCatalogStation {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.coordinate) &&
    value.coordinate.length === 2 &&
    value.coordinate.every(isFiniteNumber)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
