import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "infra/packaging/agent-api.json"), "utf8"));
if (manifest.runtime !== "nodejs22.x" || manifest.handler !== "index.handler") {
  throw new Error("Node Lambda runtimeまたはhandlerが不正です");
}
if (!Array.isArray(manifest.files) || manifest.files.length !== 1 || manifest.files[0] !== "index.cjs") {
  throw new Error("Lambda packageには単一bundleだけを含めてください");
}
const bundle = resolve(root, manifest.source, manifest.files[0]);
const metadata = await stat(bundle);
if (!metadata.isFile() || metadata.size < 1 || metadata.size > 20 * 1_024 * 1_024) {
  throw new Error("Lambda bundleのサイズが不正です");
}
const source = await readFile(bundle, "utf8");
if (!source.includes("handler")) throw new Error("Lambda handler exportが見つかりません");
for (const name of [
  "AI_TIMETABLE_BUCKET",
  "TRAFFIC_SNAPSHOT_BUCKET",
  "TRAVEL_PROVIDER_SECRET_ARN",
  "CONVERSATION_FEEDBACK_BUCKET",
  "AGENT_TRACE_BUCKET",
  "SUMMARY_TABLE",
  "DELAY_SUMMARY_TABLE",
]) {
  process.env[name] ??= `lambda-package-check-${name.toLowerCase()}`;
}
process.env.VIEWER_ORIGIN ??= "https://viewer.example.com";
process.env.COGNITO_USER_POOL_ID ??= "ap-northeast-1_PackageCheck";
process.env.COGNITO_CLIENT_ID ??= "package-check-client";
const loaded = await import(pathToFileURL(bundle).href);
if (typeof loaded.handler !== "function") {
  throw new Error("Lambda bundleをNode.jsで読み込めません");
}
// Exercise the actual production bundle without reaching AWS/model/provider adapters.
for (const operation of [undefined, "bedrock_converse", "unknown", "agent_trace", "conversation_feedback"]) {
  const response = await loaded.handler({ rawPath: "/api/agent", requestContext: { http: { method: "POST" } },
    body: JSON.stringify({ operation, messages: [{ role: "user", content: [{ text: "package closure check" }] }] }) });
  if (response.statusCode !== 410) throw new Error("Production bundle reopened legacy conversation ingress");
}
const unauthenticated = await loaded.handler({ rawPath: "/api/agent", requestContext: { http: { method: "POST" } },
  body: JSON.stringify({ operation: "place_detail_research", query: "package check" }) });
if (unauthenticated.statusCode !== 401) throw new Error("Production paid operation must require Cognito before AWS calls");
console.log(JSON.stringify({ runtime: manifest.runtime, handler: manifest.handler, files: manifest.files, bytes: metadata.size }));

// #409's autonomous host is a separate deployment artifact, not part of the public Agent bundle.
const recheck = JSON.parse(await readFile(resolve(root, "infra/packaging/trip-recheck.json"), "utf8"));
if (recheck.runtime !== "nodejs22.x" || recheck.handler !== "index.handler" ||
    JSON.stringify(recheck.files) !== '["index.cjs"]') throw new Error("Invalid recheck package contract");
const recheckBundle = resolve(root, recheck.source, recheck.files[0]);
const recheckMetadata = await stat(recheckBundle);
if (!recheckMetadata.isFile() || recheckMetadata.size < 1 || recheckMetadata.size > 20 * 1_024 * 1_024 ||
    typeof (await import(pathToFileURL(recheckBundle).href)).handler !== "function") throw new Error("Invalid recheck bundle");
console.log(JSON.stringify({ package: "trip-recheck", runtime: recheck.runtime, bytes: recheckMetadata.size }));

const notification = JSON.parse(await readFile(resolve(root, "infra/packaging/notification.json"), "utf8"));
if (notification.runtime !== "nodejs22.x" || notification.handler !== "index.handler" ||
    JSON.stringify(notification.files) !== '["index.cjs"]') throw new Error("Invalid notification package contract");
const notificationBundle = resolve(root, notification.source, notification.files[0]);
const notificationMetadata = await stat(notificationBundle);
if (!notificationMetadata.isFile() || notificationMetadata.size < 1 || notificationMetadata.size > 20 * 1_024 * 1_024 ||
    typeof (await import(pathToFileURL(notificationBundle).href)).handler !== "function") throw new Error("Invalid notification bundle");
console.log(JSON.stringify({ package: "notification", runtime: notification.runtime, bytes: notificationMetadata.size }));

const provider = JSON.parse(await readFile(resolve(root, "infra/packaging/fixed-egress-provider.json"), "utf8"));
if (provider.runtime !== "nodejs22.x" || provider.handler !== "index.handler" ||
    JSON.stringify(provider.files) !== '["index.cjs"]') throw new Error("Invalid Provider package contract");
const providerBundle = resolve(root, provider.source, provider.files[0]);
const providerMetadata = await stat(providerBundle);
if (!providerMetadata.isFile() || providerMetadata.size < 1 || providerMetadata.size > 20 * 1_024 * 1_024 ||
    typeof (await import(pathToFileURL(providerBundle).href)).handler !== "function") throw new Error("Invalid Provider bundle");
console.log(JSON.stringify({ package: "fixed-egress-provider", runtime: provider.runtime, bytes: providerMetadata.size }));

// Streaming runtime global is provided by AWS; use a local shim only to validate the bundle export.
const stream = JSON.parse(await readFile(resolve(root, "infra/packaging/agent-stream.json"), "utf8"));
if (stream.runtime !== "nodejs22.x" || stream.handler !== "index.handler" ||
    JSON.stringify(stream.files) !== '["index.cjs"]') throw new Error("Invalid streaming package contract");
const streamBundle = resolve(root, stream.source, stream.files[0]);
const streamMetadata = await stat(streamBundle);
if (!streamMetadata.isFile() || streamMetadata.size < 1 || streamMetadata.size > 20 * 1_024 * 1_024) throw new Error("Invalid streaming bundle size");
const { Writable } = await import("node:stream");
const previousStreamingApi = globalThis.awslambda;
try {
  let status;
  globalThis.awslambda = {
    streamifyResponse: handler => handler,
    HttpResponseStream: { from: (output, metadata) => { status = metadata.statusCode; return output; } },
  };
  const streaming = await import(pathToFileURL(streamBundle).href);
  if (typeof streaming.handler !== "function") throw new Error("Invalid streaming handler export");
  await streaming.handler({}, new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
  if (status !== 404) throw new Error("Streaming bundle must reject an unknown route without starting a turn");
} finally {
  if (previousStreamingApi === undefined) delete globalThis.awslambda;
  else globalThis.awslambda = previousStreamingApi;
}
console.log(JSON.stringify({ package: "agent-stream", runtime: stream.runtime, bytes: streamMetadata.size }));

const tripApi = JSON.parse(await readFile(resolve(root, "infra/packaging/trip-api.json"), "utf8"));
if (tripApi.runtime !== "nodejs22.x" || tripApi.handler !== "index.handler" ||
    JSON.stringify(tripApi.files) !== '["index.cjs"]') throw new Error("Invalid Trip API package contract");
const tripApiBundle = resolve(root, tripApi.source, tripApi.files[0]);
const tripApiMetadata = await stat(tripApiBundle);
if (!tripApiMetadata.isFile() || tripApiMetadata.size < 1 || tripApiMetadata.size > 20 * 1_024 * 1_024) throw new Error("Invalid Trip API bundle size");
const tripApiModule = await import(pathToFileURL(tripApiBundle).href);
if (typeof tripApiModule.handler !== "function") throw new Error("Invalid Trip API handler export");
const closedTripApi = await tripApiModule.handler({ rawPath: "/api/trips/v1", requestContext: { http: { method: "POST" } } });
if (closedTripApi.statusCode !== 503) throw new Error("Trip API bundle must fail closed without its gate");
console.log(JSON.stringify({ package: "trip-api", runtime: tripApi.runtime, bytes: tripApiMetadata.size }));
