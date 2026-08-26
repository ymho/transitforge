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
