import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

function requireValue(condition) {
  if (!condition) throw new Error("OTP smoke configuration or response mismatch");
}
function date(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Only a small allowlisted Lambda projection is read; no Environment dump or current.json. */
export function manifestSource(runtime, config) {
  requireValue(config?.enable_otp_route_service === true && runtime?.state === "Active" && runtime.updateStatus === "Successful");
  const region = config.otp_region_id ?? "izumo-matsue";
  requireValue(/^[a-z][a-z0-9-]{2,63}$/u.test(region) && /^\d{8}T\d{6}Z-[0-9a-f]{12}$/u.test(config.otp_graph_version) &&
    /^[0-9a-f]{64}$/u.test(config.otp_graph_sha256) && /^docker\.io\/opentripplanner\/opentripplanner@sha256:[0-9a-f]{64}$/u.test(config.otp_image));
  requireValue(runtime.region === region && runtime.version === config.otp_graph_version && runtime.sha256 === config.otp_graph_sha256 && runtime.image === config.otp_image &&
    typeof runtime.bucket === "string" && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(runtime.bucket) &&
    runtime.key === `otp/${region}/versions/${config.otp_graph_version}/manifest.json`);
  return `s3://${runtime.bucket}/${runtime.key}`;
}

function coverage(runtime, config, manifest) {
  manifestSource(runtime, config);
  requireValue(["otp-graph-manifest-v1", "otp-graph-manifest-v2"].includes(manifest?.schemaVersion) &&
    manifest.version === config.otp_graph_version && manifest.regionId === runtime.region && manifest.otpImage === config.otp_image &&
    manifest.graph?.sha256 === config.otp_graph_sha256 && manifest.graph?.bucket === runtime.bucket &&
    manifest.graph?.key === runtime.key.replace(/manifest\.json$/u, "graph.obj") &&
    date(manifest.serviceStart) && date(manifest.serviceEnd) && manifest.serviceStart <= manifest.serviceEnd);
  const bounds = manifest.bounds;
  requireValue(bounds && [bounds.south, bounds.west, bounds.north, bounds.east].every(Number.isFinite) &&
    bounds.south >= -90 && bounds.north <= 90 && bounds.west >= -180 && bounds.east <= 180 && bounds.south < bounds.north && bounds.west < bounds.east);
  for (const field of ["feedUrl", "feedRetrievedAt", "graphBuiltAt", "attribution"]) requireValue(typeof manifest[field] === "string" && manifest[field].length > 0);
  const result = Object.fromEntries(["bounds", "serviceStart", "serviceEnd", "feedUrl", "feedRetrievedAt", "graphBuiltAt", "attribution"].map(key => [key, manifest[key]]));
  if (manifest.schemaVersion === "otp-graph-manifest-v2") {
    const feeds = manifest.sources?.gtfs;
    requireValue(Array.isArray(feeds) && feeds.length > 0 && feeds.length <= 32);
    result.feeds = feeds.map(feed => {
      requireValue(typeof feed.feedId === "string" && date(feed.serviceStart) && date(feed.serviceEnd) && feed.serviceStart <= feed.serviceEnd);
      return { feedId: feed.feedId, bounds: feed.bounds, serviceStart: feed.serviceStart, serviceEnd: feed.serviceEnd, feedUrl: feed.resolvedUrl, attribution: feed.attribution };
    });
  }
  return result;
}

/** Historical load/connectivity probe at the selected manifest's first service date, not a freshness assertion. */
export function smokeRequest(runtime, config, manifest) {
  const expected = coverage(runtime, config, manifest);
  // These existing coordinates are a bounded Izumo walk case, not generic national coverage.
  requireValue(runtime.region === "izumo-matsue");
  const origin = { name: "出雲市駅", latitude: 35.36092, longitude: 132.75640 };
  const destination = { name: "出雲科学館", latitude: 35.36104, longitude: 132.77344 };
  for (const point of [origin, destination]) requireValue(point.latitude >= expected.bounds.south && point.latitude <= expected.bounds.north &&
    point.longitude >= expected.bounds.west && point.longitude <= expected.bounds.east);
  return { origin, destination, departureAt: `${expected.serviceStart}T10:00:00+09:00`, mode: "walk" };
}

export function verifySmoke(runtime, config, manifest, response) {
  const expected = coverage(runtime, config, manifest);
  requireValue(response?.status === "available" && Array.isArray(response.routes) && response.routes.length > 0 && isDeepStrictEqual(response.coverage, expected));
  return `### OTP route smoke\n- Pinned graph: ${config.otp_graph_version}\n- Manifest period: ${expected.serviceStart} to ${expected.serviceEnd}\n- Walking route: available (test date ${expected.serviceStart}; not a freshness or bus-route check)\n`;
}

function read(path) {
  const content = readFileSync(path);
  requireValue(content.byteLength <= 64_000);
  return JSON.parse(content.toString("utf8"));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, ...paths] = process.argv.slice(2);
    requireValue(["source", "request", "verify"].includes(command));
    requireValue(paths.length === ({ source: 2, request: 3, verify: 4 })[command]);
    const values = paths.map(read);
    const result = command === "source" ? manifestSource(...values) : command === "request" ? JSON.stringify(smokeRequest(...values)) : verifySmoke(...values);
    process.stdout.write(`${result}\n`);
  } catch {
    process.stderr.write("OTP route smoke failed; inspect the pinned manifest, deployed configuration and response.\n");
    process.exitCode = 1;
  }
}
