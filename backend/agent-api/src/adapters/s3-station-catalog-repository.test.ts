import { expect, it, vi } from "vitest";
import { maximumStationCatalogEnvelopeBytes, S3StationCatalogRepository } from "./s3-station-catalog-repository.js";

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

function envelope(bytes?: number, catalog: unknown = { schema_version: "station-line-catalog-v1", source: "fixture",
  lines: [{ operator: "JR", line: "山陰線", stations: [{ name: "豊岡", coordinate: [134.82, 35.54] }] }] }) {
  const encoded = new TextEncoder().encode(JSON.stringify({ schema_version: "train-index-v1", station_line_catalog: catalog }));
  if (!bytes) return encoded;
  const body = new Uint8Array(bytes).fill(32); body.set(encoded); return body;
}

it("accepts a production-sized Viewer envelope and shares the validated catalog across concurrent readers", async () => {
  const getObject = vi.fn(async () => ({ Body: envelope(25_000_000) }));
  const repository = new S3StationCatalogRepository({ getObject }, "bucket");
  const [rail, ground] = await Promise.all([repository.load(), repository.load()]);
  expect(rail).toBe(ground);
  expect(rail.lines[0]?.stations[0]?.name).toBe("豊岡");
  expect(await repository.load()).toBe(rail);
  expect(getObject).toHaveBeenCalledTimes(1);
});

it("does not retain a failed download, while still rejecting oversized or invalid identity data", async () => {
  const getObject = vi.fn().mockRejectedValueOnce(new Error("transient download failure"))
    .mockResolvedValue({ Body: envelope() });
  const repository = new S3StationCatalogRepository({ getObject }, "bucket");
  await expect(repository.load()).rejects.toThrow("transient download failure");
  expect(await repository.load()).toMatchObject({ source: "fixture" });
  expect(getObject).toHaveBeenCalledTimes(2);
  for (const Body of [new Uint8Array(maximumStationCatalogEnvelopeBytes + 1), envelope(undefined, {
    schema_version: "station-line-catalog-v1", source: "fixture",
    lines: [{ operator: "JR", line: "山陰線", stations: [{ name: "豊岡", coordinate: [134.82, "unknown"] }] }],
  })]) {
    await expect(new S3StationCatalogRepository({ getObject: async () => ({ Body }) }, "bucket").load()).rejects.toThrow("Station catalog unavailable");
  }
});
