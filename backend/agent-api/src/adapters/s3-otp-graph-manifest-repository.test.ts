import { expect, it } from "vitest";
import { S3OtpGraphManifestRepository } from "./s3-otp-graph-manifest-repository.js";

const version = "20260928T080000Z-aaaaaaaaaaaa";
const manifest = { schemaVersion: "otp-graph-manifest-v1", version,
  graph: { bucket: "source", key: `otp/izumo-matsue/versions/${version}/graph.obj`, bytes: 42, sha256: "a".repeat(64) },
  otpImage: "docker.io/opentripplanner/opentripplanner@sha256:" + "b".repeat(64),
  bounds: { south: 35.3, west: 132.6, north: 35.6, east: 132.9 }, serviceStart: "2026-10-01", serviceEnd: "2026-10-31",
  feedUrl: "https://example.org/gtfs.zip", feedRetrievedAt: "2026-09-28T08:00:00Z", graphBuiltAt: "2026-09-28T08:00:00Z",
  attribution: "Bus / OSM",
  sources: {
    gtfs: { requestedUrl: "https://example.org/gtfs.zip", resolvedUrl: "https://example.org/gtfs.zip", bytes: 20,
      sha256: "c".repeat(64), fileName: "transit.gtfs.zip",
      object: { bucket: "source", key: `otp/izumo-matsue/sources/gtfs/${"c".repeat(64)}.zip` } },
    osm: { requestedUrl: "https://example.org/osm.pbf", resolvedUrl: "https://example.org/osm.pbf", bytes: 30,
      sha256: "d".repeat(64), fileName: "streets.osm.pbf",
      object: { bucket: "source", key: `otp/izumo-matsue/sources/osm/${"d".repeat(64)}.osm.pbf` } },
  } };

it("loads one pinned graph and caches its validated coverage", async () => {
  let calls = 0;
  const repository = new S3OtpGraphManifestRepository({ getObject: async () => { calls++; return { Body: new TextEncoder().encode(JSON.stringify(manifest)) }; } }, "source", `otp/izumo-matsue/versions/${version}/manifest.json`, version);
  await expect(repository.load()).resolves.toMatchObject({ version, coverage: { serviceEnd: "2026-10-31" }, graph: { bytes: 42 } });
  await repository.load(); expect(calls).toBe(1);
});

it("rejects a current pointer, mismatched graph key and unpinned image", async () => {
  const load = (value: unknown, key = `otp/izumo-matsue/versions/${version}/manifest.json`) =>
    new S3OtpGraphManifestRepository({ getObject: async () => ({ Body: new TextEncoder().encode(JSON.stringify(value)) }) }, "source", key, version).load();
  await expect(load(manifest, "otp/izumo-matsue/current.json")).rejects.toThrow();
  await expect(load({ ...manifest, graph: { ...manifest.graph, key: "otp/other/graph.obj" } })).rejects.toThrow();
  await expect(load({ ...manifest, otpImage: "latest" })).rejects.toThrow();
  await expect(load({ ...manifest, otpImage: "example.org/otp@sha256:" + "b".repeat(64) })).rejects.toThrow();
  await expect(load({ ...manifest, serviceEnd: "2026-02-31" })).rejects.toThrow();
});

it("requires the configured image and full graph hash to match the manifest", async () => {
  const repository = (image: string, hash: string) => new S3OtpGraphManifestRepository({
    getObject: async () => ({ Body: new TextEncoder().encode(JSON.stringify(manifest)) }),
  }, "source", `otp/izumo-matsue/versions/${version}/manifest.json`, version, image, hash).load();
  await expect(repository(manifest.otpImage, manifest.graph.sha256)).resolves.toMatchObject({ version });
  await expect(repository(manifest.otpImage, "c".repeat(64))).rejects.toThrow();
  await expect(repository("docker.io/opentripplanner/opentripplanner@sha256:" + "d".repeat(64), manifest.graph.sha256)).rejects.toThrow();
});
