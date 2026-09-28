import type { StationLineCatalog } from "@raiquora/train/station";
import type { StationCatalogRepository } from "../ports/station-catalog-repository.js";

/** Uses the same generated station catalog as the Viewer; a station name alone is not a coordinate. */
export class S3StationCatalogRepository implements StationCatalogRepository {
  constructor(private readonly client: { getObject(input: { Bucket: string; Key: string }): Promise<{ Body?: Uint8Array }> },
    private readonly bucket: string, private readonly key = "viewer-input/train_index.json") {}

  async load(): Promise<StationLineCatalog> {
    const response = await this.client.getObject({ Bucket: this.bucket, Key: this.key });
    if (!response.Body || response.Body.byteLength > 15_000_000) throw new Error("Station catalog unavailable");
    const index: unknown = JSON.parse(new TextDecoder().decode(response.Body));
    if (!record(index) || index.schema_version !== "train-index-v1" || !record(index.station_line_catalog)) throw new Error("Station catalog unavailable");
    const catalog = index.station_line_catalog;
    if (catalog.schema_version !== "station-line-catalog-v1" || typeof catalog.source !== "string" || !catalog.source ||
      !Array.isArray(catalog.lines) || catalog.lines.length > 1_000 || catalog.lines.some(line => !record(line) ||
        typeof line.operator !== "string" || typeof line.line !== "string" || !Array.isArray(line.stations) ||
        line.stations.length > 10_000 || line.stations.some(station => !record(station) || typeof station.name !== "string" ||
          !station.name || !Array.isArray(station.coordinate) || station.coordinate.length !== 2 ||
          station.coordinate.some(value => typeof value !== "number" || !Number.isFinite(value))))) throw new Error("Station catalog unavailable");
    return catalog as unknown as StationLineCatalog;
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
