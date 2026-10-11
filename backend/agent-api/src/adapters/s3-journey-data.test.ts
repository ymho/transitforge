import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { S3JourneyDataRepository } from "./s3-journey-data.js";

describe("S3JourneyDataRepository", () => {
  it("loads the versioned daily index and caches it by ETag", async () => {
    const index = { schema_version: "timetable-connection-index-v1", trips: {}, connections: [] };
    const headObject = vi.fn(async () => ({ ETag: "v1" }));
    const getObject = vi.fn(async () => ({ Body: gzipSync(JSON.stringify(index)) }));
    const repository = new S3JourneyDataRepository({ headObject, getObject }, { indexBucket: "bucket", indexPrefix: "/graph/" });
    expect(await repository.loadIndex("2026-08-28", "connection")).toEqual(index);
    expect(await repository.loadIndex("2026-08-28", "connection")).toEqual(index);
    expect(getObject).toHaveBeenCalledTimes(1);
  });
});

it("uses the station catalog in the same immutable search/selection input and refuses missing identity data", async () => {
  const index = { schema_version: "timetable-connection-index-v1", trips: {}, connections: [] };
  const client = { headObject: async () => ({ ETag: "v1" }), getObject: async () => ({ Body: gzipSync(JSON.stringify(index)) }) };
  const catalog = { schema_version: "station-line-catalog-v1" as const, source: "fixture", lines: [] };
  const repository = new S3JourneyDataRepository(client, { indexBucket: "bucket", indexPrefix: "graph", stationCatalog: { load: async () => catalog } });
  expect((await repository.loadIndex("2026-10-12", "connection")).station_line_catalog).toEqual(catalog);
  const missing = new S3JourneyDataRepository(client, { indexBucket: "bucket", indexPrefix: "graph", stationCatalog: { load: async () => { throw new Error("missing"); } } });
  await expect(missing.loadIndex("2026-10-12", "connection")).rejects.toThrow("検索インデックスを読み込めません");
});
