import { expect, it } from "vitest";
import { S3StationCatalogRepository } from "./s3-station-catalog-repository.js";

it("reads the generated Viewer catalog and rejects a missing or malformed copy", async () => {
  let key = "";
  const repo = new S3StationCatalogRepository({ getObject: async request => { key = request.Key; return { Body: new TextEncoder().encode(JSON.stringify({
    schema_version: "train-index-v1", station_line_catalog: { schema_version: "station-line-catalog-v1", source: "fixture",
      lines: [{ operator: "JR", line: "山陰線", stations: [{ name: "出雲市", coordinate: [132.76, 35.36] }] }] },
  })) }; } }, "website-bucket");
  expect(await repo.load()).toMatchObject({ source: "fixture", lines: [{ stations: [{ name: "出雲市" }] }] });
  expect(key).toBe("viewer-input/train_index.json");
  await expect(new S3StationCatalogRepository({ getObject: async () => ({}) }, "website-bucket").load()).rejects.toThrow();
});
