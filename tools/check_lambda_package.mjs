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
const loaded = await import(pathToFileURL(bundle).href);
if (typeof loaded.handler !== "function") {
  throw new Error("Lambda bundleをNode.jsで読み込めません");
}
console.log(JSON.stringify({ runtime: manifest.runtime, handler: manifest.handler, files: manifest.files, bytes: metadata.size }));
