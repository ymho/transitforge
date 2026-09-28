import type { OtpGraphManifest, OtpGraphManifestRepository } from "../ports/otp-graph-manifest-repository.js";

/** Reads one explicitly pinned graph manifest. current.json is never a runtime input. */
export class S3OtpGraphManifestRepository implements OtpGraphManifestRepository {
  private loaded?: Promise<OtpGraphManifest>;
  constructor(private readonly s3: { getObject(input: { Bucket: string; Key: string }): Promise<{ Body?: Uint8Array }> },
    private readonly bucket: string, private readonly key: string, private readonly expectedVersion: string,
    private readonly expectedOtpImage?: string, private readonly expectedGraphSha256?: string) {}
  load(): Promise<OtpGraphManifest> { return this.loaded ??= this.read(); }
  private async read(): Promise<OtpGraphManifest> {
    if (!/^\d{8}T\d{6}Z-[0-9a-f]{12}$/u.test(this.expectedVersion) || !this.bucket ||
        this.expectedOtpImage !== undefined && !/^docker\.io\/opentripplanner\/opentripplanner@sha256:[0-9a-f]{64}$/u.test(this.expectedOtpImage) ||
        this.expectedGraphSha256 !== undefined && !/^[0-9a-f]{64}$/u.test(this.expectedGraphSha256) ||
        this.key !== `otp/izumo-matsue/versions/${this.expectedVersion}/manifest.json`) throw new Error("OTP graph manifest unavailable");
    const response = await this.s3.getObject({ Bucket: this.bucket, Key: this.key });
    if (!response.Body || response.Body.byteLength > 64_000) throw new Error("OTP graph manifest unavailable");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.Body)); }
    catch { throw new Error("OTP graph manifest unavailable"); }
    if (!record(value) || value.schemaVersion !== "otp-graph-manifest-v1" || value.version !== this.expectedVersion ||
        !record(value.graph) || value.graph.bucket !== this.bucket ||
        value.graph.key !== `otp/izumo-matsue/versions/${this.expectedVersion}/graph.obj` ||
        typeof value.graph.bytes !== "number" || !Number.isSafeInteger(value.graph.bytes) || value.graph.bytes <= 0 || value.graph.bytes > 20 * 1024 ** 3 ||
        typeof value.graph.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.graph.sha256) ||
        this.expectedGraphSha256 !== undefined && value.graph.sha256 !== this.expectedGraphSha256 ||
        typeof value.otpImage !== "string" || !/^docker\.io\/opentripplanner\/opentripplanner@sha256:[0-9a-f]{64}$/u.test(value.otpImage) ||
        this.expectedOtpImage !== undefined && value.otpImage !== this.expectedOtpImage) throw new Error("OTP graph manifest unavailable");
    const bounds = value.bounds;
    const sources = value.sources;
    if (!record(bounds) || !finite(bounds.south) || !finite(bounds.west) || !finite(bounds.north) || !finite(bounds.east) ||
        bounds.south < -90 || bounds.north > 90 || bounds.west < -180 || bounds.east > 180 ||
        bounds.south >= bounds.north || bounds.west >= bounds.east ||
        !date(value.serviceStart) || !date(value.serviceEnd) || value.serviceStart > value.serviceEnd ||
        !short(value.feedUrl, 1_000) || !/^https:\/\//u.test(value.feedUrl) || !instant(value.feedRetrievedAt) ||
        !instant(value.graphBuiltAt) || !short(value.attribution, 500) ||
        value.version !== `${value.graphBuiltAt.replace(/[-:]/gu, "").replace("+00:00", "Z")}-${value.graph.sha256.slice(0, 12)}` ||
        !record(sources) || !source(sources.gtfs, this.bucket, "gtfs", ".zip") || !source(sources.osm, this.bucket, "osm", ".osm.pbf") ||
        sources.gtfs.resolvedUrl !== value.feedUrl) throw new Error("OTP graph manifest unavailable");
    return { version: this.expectedVersion,
      graph: { bucket: this.bucket, key: value.graph.key, bytes: value.graph.bytes, sha256: value.graph.sha256 },
      otpImage: value.otpImage,
      coverage: { bounds: { south: bounds.south, west: bounds.west, north: bounds.north, east: bounds.east },
        serviceStart: value.serviceStart, serviceEnd: value.serviceEnd, feedUrl: value.feedUrl,
        feedRetrievedAt: value.feedRetrievedAt, graphBuiltAt: value.graphBuiltAt, attribution: value.attribution } };
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function short(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function source(value: unknown, bucket: string, kind: "gtfs" | "osm", suffix: string): value is Record<string, unknown> {
  if (!record(value) || !short(value.requestedUrl, 1_000) || !short(value.resolvedUrl, 1_000) ||
      !/^https:\/\//u.test(value.requestedUrl) || !/^https:\/\//u.test(value.resolvedUrl) ||
      typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 ||
      value.bytes > (kind === "gtfs" ? 512 * 1024 ** 2 : 8 * 1024 ** 3) ||
      typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256) ||
      value.fileName !== (kind === "gtfs" ? "transit.gtfs.zip" : "streets.osm.pbf") || !record(value.object)) return false;
  return value.object.bucket === bucket && value.object.key === `otp/izumo-matsue/sources/${kind}/${value.sha256}${suffix}`;
}
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function instant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) && Number.isFinite(Date.parse(value));
}
