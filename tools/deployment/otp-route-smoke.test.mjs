import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { manifestSource, smokeRequest, verifySmoke } from "./otp-route-smoke.mjs";

const config = { enable_otp_route_service: true, otp_graph_version: "20261102T000000Z-aaaaaaaaaaaa", otp_graph_sha256: "a".repeat(64), otp_image: "docker.io/opentripplanner/opentripplanner@sha256:" + "b".repeat(64) };
const runtime = { state: "Active", updateStatus: "Successful", bucket: "test-source", key: `otp/izumo-matsue/versions/${config.otp_graph_version}/manifest.json`, version: config.otp_graph_version, region: "izumo-matsue", image: config.otp_image, sha256: config.otp_graph_sha256 };
const manifest = { schemaVersion: "otp-graph-manifest-v1", regionId: runtime.region, version: runtime.version, otpImage: runtime.image,
  graph: { bucket: runtime.bucket, key: runtime.key.replace("manifest.json", "graph.obj"), sha256: runtime.sha256 },
  bounds: { south: 35.1, north: 35.7, west: 132.5, east: 133.3 }, serviceStart: "2026-11-01", serviceEnd: "2027-01-31",
  feedUrl: "https://example.org/november.zip", feedRetrievedAt: "2026-11-02T00:00:00Z", graphBuiltAt: "2026-11-02T00:00:00Z", attribution: "Bus / OSM" };
const coverage = Object.fromEntries(["bounds", "serviceStart", "serviceEnd", "feedUrl", "feedRetrievedAt", "graphBuiltAt", "attribution"].map(key => [key, manifest[key]]));
const response = { status: "available", routes: [{}], coverage };

test("reads only the configured version and prepares a November request from the manifest", () => {
  assert.equal(manifestSource(runtime, config), `s3://${runtime.bucket}/${runtime.key}`);
  assert.equal(smokeRequest(runtime, config, manifest).departureAt, "2026-11-01T10:00:00+09:00");
  assert.match(verifySmoke(runtime, config, manifest, response), /2026-11-01 to 2027-01-31/u);
  assert.match(verifySmoke(runtime, config, manifest, response), /not a freshness or bus-route check/u);
});
for (const change of [{ version: "old" }, { key: "otp/izumo-matsue/current.json" }, { sha256: "c".repeat(64) }, { image: "other" }, { region: "chugoku" }, { state: "Pending" }]) {
  test(`rejects deployed configuration mismatch ${JSON.stringify(change)}`, () => assert.throws(() => manifestSource({ ...runtime, ...change }, config)));
}
for (const change of [{ version: "old" }, { serviceStart: "2026-02-30" }, { graph: { ...manifest.graph, sha256: "c".repeat(64) } }, { otpImage: "other" }]) {
  test(`rejects manifest mismatch ${JSON.stringify(change)}`, () => assert.throws(() => smokeRequest(runtime, config, { ...manifest, ...change })));
}
for (const change of [{ status: "no_route" }, { routes: [] }, { coverage: { ...coverage, serviceEnd: "2026-10-31" } }, { coverage: { ...coverage, feedUrl: "https://example.org/old.zip" } }]) {
  test("rejects unsuccessful routes or stale coverage", () => assert.throws(() => verifySmoke(runtime, config, manifest, { ...response, ...change })));
}
test("compares per-feed v2 coverage as well as the aggregate period", () => {
  const feed = { feedId: "matsue-ichibata", bounds: manifest.bounds, serviceStart: manifest.serviceStart, serviceEnd: manifest.serviceEnd, resolvedUrl: manifest.feedUrl, attribution: "Bus" };
  const multi = { ...manifest, schemaVersion: "otp-graph-manifest-v2", sources: { gtfs: [feed] } };
  const projected = { feedId: feed.feedId, bounds: feed.bounds, serviceStart: feed.serviceStart, serviceEnd: feed.serviceEnd, feedUrl: feed.resolvedUrl, attribution: feed.attribution };
  assert.doesNotThrow(() => verifySmoke(runtime, config, multi, { ...response, coverage: { ...coverage, feeds: [projected] } }));
  assert.throws(() => verifySmoke(runtime, config, multi, response));
  assert.throws(() => verifySmoke(runtime, config, multi, { ...response, coverage: { ...coverage, feeds: [{ ...projected, serviceEnd: "2026-10-31" }] } }));
});

const workflow = readFileSync(new URL("../../.github/workflows/cd.yml", import.meta.url), "utf8");
const step = workflow.match(/      - name: Verify deployed OTP route service\n([\s\S]*?)(?=\n      - name:)/u)?.[1];
assert.ok(step);
const shell = step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /u, "")).join("\n");
const script = fileURLToPath(new URL("./otp-route-smoke.mjs", import.meta.url));
for (const mode of ["success", "stale-coverage", "wrong-config", "s3-failure", "unavailable"]) {
  test(`executes actual CD shell with mocked AWS: ${mode}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "otp-smoke-"));
    try {
      // The shell uses repository-relative paths; fixtures are isolated from the checkout.
      mkdirSync(join(directory, "tools/deployment"), { recursive: true });
      mkdirSync(join(directory, "infra/terraform/environments/dev"), { recursive: true });
      writeFileSync(join(directory, "tools/deployment/otp-route-smoke.mjs"), readFileSync(script));
      writeFileSync(join(directory, "infra/terraform/environments/dev/otp-runtime.auto.tfvars.json"), JSON.stringify(config));
      writeFileSync(join(directory, "runtime-fixture.json"), JSON.stringify(mode === "wrong-config" ? { ...runtime, version: "old" } : runtime));
      writeFileSync(join(directory, "manifest-fixture.json"), JSON.stringify(manifest));
      writeFileSync(join(directory, "response-fixture.json"), JSON.stringify(mode === "unavailable" ? { status: "unavailable", routes: [] } : mode === "stale-coverage" ? { ...response, coverage: { ...coverage, serviceEnd: "2026-10-31" } } : response));
      const mock = `#!${process.execPath}\n` + `
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync('calls.jsonl', JSON.stringify(a)+'\\n');
if (a[0] === 'lambda' && a[1] === 'wait') process.exit(0);
if (a[0] === 'lambda' && a[1] === 'get-function-configuration') { process.stdout.write(fs.readFileSync('runtime-fixture.json')); process.exit(0); }
if (a[0] === 's3' && a[1] === 'cp') {
  if (process.env.MOCK_MODE === 's3-failure') process.exit(1);
  fs.copyFileSync('manifest-fixture.json', a[3]); process.exit(0);
}
if (a[0] === 'lambda' && a[1] === 'invoke') {
  const request = JSON.parse(fs.readFileSync(a[a.indexOf('--payload')+1].replace('file://','')));
  if (request.departureAt !== '2026-11-01T10:00:00+09:00') process.exit(2);
  fs.copyFileSync('response-fixture.json', a.at(-1)); process.stdout.write('{"StatusCode":200}'); process.exit(0);
}
process.exit(3);
`;
      writeFileSync(join(directory, "aws"), mock, { mode: 0o755 });
      writeFileSync(join(directory, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const summary = join(directory, "summary.md");
      const result = spawnSync("bash", ["-c", shell], { cwd: directory, encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, OTP_BRIDGE_FUNCTION: "test-bridge", GITHUB_STEP_SUMMARY: summary, MOCK_MODE: mode } });
      if (mode === "success") {
        assert.equal(result.status, 0, result.stderr);
        assert.match(readFileSync(summary, "utf8"), /Manifest period: 2026-11-01 to 2027-01-31/u);
      } else assert.notEqual(result.status, 0);
      const calls = readFileSync(join(directory, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(calls.filter(a => a[0] === "s3").length, mode === "wrong-config" ? 0 : 1);
      assert.equal(calls.filter(a => a[1] === "invoke").length, mode === "unavailable" ? 18 : mode === "wrong-config" || mode === "s3-failure" ? 0 : 1);
      assert.ok(!calls.some(a => a.includes("current.json")));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
