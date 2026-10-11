import type { OtpGraphManifest, OtpGraphManifestRepository } from "../ports/otp-graph-manifest-repository.js";
import type { GroundRouteCoverage } from "../ports/ground-route-provider.js";

/** Reads one explicitly pinned graph manifest. current.json is never a runtime input. */
export class S3OtpGraphManifestRepository implements OtpGraphManifestRepository {
  private loaded?: Promise<OtpGraphManifest>;
  constructor(private readonly s3: { getObject(input: { Bucket: string; Key: string }): Promise<{ Body?: Uint8Array }> },
    private readonly bucket: string, private readonly key: string, private readonly expectedVersion: string,
    private readonly expectedOtpImage?: string, private readonly expectedGraphSha256?: string,
    private readonly regionId = "izumo-matsue") {}
  load(): Promise<OtpGraphManifest> { return this.loaded ??= this.read(); }
  private async read(): Promise<OtpGraphManifest> {
    const root = `otp/${this.regionId}`;
    if (!/^[a-z][a-z0-9-]{2,63}$/u.test(this.regionId) || !/^\d{8}T\d{6}Z-[0-9a-f]{12}$/u.test(this.expectedVersion) || !this.bucket ||
        this.expectedOtpImage !== undefined && !image(this.expectedOtpImage) ||
        this.expectedGraphSha256 !== undefined && !hash(this.expectedGraphSha256) ||
        this.key !== `${root}/versions/${this.expectedVersion}/manifest.json`) throw new Error("OTP graph manifest unavailable");
    const response = await this.s3.getObject({ Bucket: this.bucket, Key: this.key });
    if (!response.Body || response.Body.byteLength > 64_000) throw new Error("OTP graph manifest unavailable");
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.Body)); }
    catch { throw new Error("OTP graph manifest unavailable"); }
    if (!record(value) || !["otp-graph-manifest-v1", "otp-graph-manifest-v2"].includes(String(value.schemaVersion)) || value.version !== this.expectedVersion ||
        value.regionId !== undefined && value.regionId !== this.regionId ||
        !record(value.graph) || value.graph.bucket !== this.bucket ||
        value.graph.key !== `${root}/versions/${this.expectedVersion}/graph.obj` ||
        !positiveBytes(value.graph.bytes, 20 * 1024 ** 3) || !hash(value.graph.sha256) ||
        this.expectedGraphSha256 !== undefined && value.graph.sha256 !== this.expectedGraphSha256 ||
        !image(value.otpImage) || this.expectedOtpImage !== undefined && value.otpImage !== this.expectedOtpImage ||
        !bounds(value.bounds) || !period(value) || !url(value.feedUrl) || !instant(value.feedRetrievedAt) ||
        !instant(value.graphBuiltAt) || !short(value.attribution, 500) ||
        value.version !== `${value.graphBuiltAt.replace(/[-:]/gu, "")}-${value.graph.sha256.slice(0, 12)}` ||
        !record(value.sources) || !source(value.sources.osm, this.bucket, root, "osm", "streets.osm.pbf")) throw new Error("OTP graph manifest unavailable");
    const multi = value.schemaVersion === "otp-graph-manifest-v2";
    const gtfs = multi ? value.sources.gtfs : [value.sources.gtfs];
    if (!Array.isArray(gtfs) || !gtfs.length || gtfs.length > 32) throw new Error("OTP graph manifest unavailable");
    const feeds: NonNullable<GroundRouteCoverage["feeds"]> = [];
    const ids = new Set<string>();
    for (const feed of gtfs) {
      if (!record(feed) || multi && (!short(feed.feedId, 64) || !/^[a-z][a-z0-9-]{2,63}$/u.test(feed.feedId) || ids.has(feed.feedId) ||
          !bounds(feed.bounds) || !period(feed) || !short(feed.attribution, 500)) ||
          !source(feed, this.bucket, root, "gtfs", multi ? `${feed.feedId}.gtfs.zip` : "transit.gtfs.zip")) throw new Error("OTP graph manifest unavailable");
      if (multi) {
        ids.add(String(feed.feedId));
        feeds.push({ feedId: String(feed.feedId), bounds: feed.bounds as GroundRouteCoverage["bounds"],
          serviceStart: String(feed.serviceStart), serviceEnd: String(feed.serviceEnd), feedUrl: String(feed.resolvedUrl), attribution: String(feed.attribution) });
      }
    }
    if (gtfs[0].resolvedUrl !== value.feedUrl) throw new Error("OTP graph manifest unavailable");
    if (multi && (value.regionId !== this.regionId || !record(value.buildConfig) || value.buildConfig.fileName !== "build-config.json" ||
        !hash(value.buildConfig.sha256) || !positiveBytes(value.buildConfig.bytes, 64_000) || !record(value.buildConfig.config) ||
        !Array.isArray(value.buildConfig.config.transitFeeds) || value.buildConfig.config.transitFeeds.length !== feeds.length ||
        !value.buildConfig.config.transitFeeds.every((entry, index) => record(entry) && entry.type === "gtfs" && entry.feedId === feeds[index]!.feedId && entry.source === `file:///var/opentripplanner/${feeds[index]!.feedId}.gtfs.zip`) ||
        value.serviceStart !== feeds.map(feed => feed.serviceStart).sort()[0] || value.serviceEnd !== feeds.map(feed => feed.serviceEnd).sort().at(-1) ||
        value.bounds.south !== Math.min(...feeds.map(feed => feed.bounds.south)) || value.bounds.west !== Math.min(...feeds.map(feed => feed.bounds.west)) ||
        value.bounds.north !== Math.max(...feeds.map(feed => feed.bounds.north)) || value.bounds.east !== Math.max(...feeds.map(feed => feed.bounds.east)))) throw new Error("OTP graph manifest unavailable");
    return { version: this.expectedVersion,
      graph: { bucket: this.bucket, key: value.graph.key, bytes: value.graph.bytes, sha256: value.graph.sha256 }, otpImage: value.otpImage,
      coverage: { bounds: value.bounds, serviceStart: value.serviceStart, serviceEnd: value.serviceEnd, feedUrl: value.feedUrl,
        feedRetrievedAt: value.feedRetrievedAt, graphBuiltAt: value.graphBuiltAt, attribution: value.attribution, ...(multi ? { feeds } : {}) } };
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function short(value: unknown, maximum: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum; }
function hash(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value); }
function image(value: unknown): value is string { return typeof value === "string" && /^docker\.io\/opentripplanner\/opentripplanner@sha256:[0-9a-f]{64}$/u.test(value); }
function positiveBytes(value: unknown, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum; }
function url(value: unknown): value is string {
  if (!short(value, 1_000)) return false;
  try { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password; } catch { return false; }
}
function bounds(value: unknown): value is GroundRouteCoverage["bounds"] {
  if (!record(value) || ![value.south, value.west, value.north, value.east].every(item => typeof item === "number" && Number.isFinite(item))) return false;
  const item = value as GroundRouteCoverage["bounds"];
  return item.south >= -90 && item.north <= 90 && item.west >= -180 && item.east <= 180 && item.south < item.north && item.west < item.east;
}
function period(value: Record<string, unknown>): value is Record<string, unknown> & { serviceStart: string; serviceEnd: string } { return date(value.serviceStart) && date(value.serviceEnd) && value.serviceStart <= value.serviceEnd; }
function source(value: unknown, bucket: string, root: string, kind: "gtfs" | "osm", fileName: string): value is Record<string, unknown> {
  return record(value) && url(value.requestedUrl) && url(value.resolvedUrl) && positiveBytes(value.bytes, kind === "gtfs" ? 512 * 1024 ** 2 : 8 * 1024 ** 3) &&
    hash(value.sha256) && value.fileName === fileName && record(value.object) && value.object.bucket === bucket &&
    value.object.key === `${root}/sources/${kind}/${value.sha256}${kind === "gtfs" ? ".zip" : ".osm.pbf"}`;
}
function date(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function instant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) && Number.isFinite(Date.parse(value));
}
