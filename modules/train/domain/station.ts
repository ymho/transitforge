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
