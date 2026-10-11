import { readFileSync } from "node:fs";

const spec = JSON.parse(readFileSync(new URL("../../docs/api/openapi.json", import.meta.url), "utf8"));
const resolve = value => value.$ref ? resolve(spec.components.schemas[value.$ref.split("/").at(-1)]) : value;
const fields = resolve(spec.components.schemas.BrowserAgentDiagnostic).properties;
const codes = resolve(fields.code).enum, abortReasons = resolve(fields.abortReason).enum;
const encoded = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(encoded)) throw new Error("Expected CloudWatch messages");
const rows = encoded.flatMap(raw => {
  if (typeof raw !== "string") return [];
  let value;
  try { value = JSON.parse(raw.slice(Math.max(0, raw.indexOf("{")))); } catch { return []; }
  if (typeof value.message === "string") { try { value = JSON.parse(value.message); } catch { return []; } }
  if (value.eventSource !== "browser_agent_diagnostic" || !codes.includes(value.code)) return [];
  return [{ code: value.code, reason: abortReasons.includes(value.abortReason) ? value.abortReason : "-",
    sent: typeof value.requestSent === "boolean" ? String(value.requestSent) : "-", status: Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599 ? value.httpStatus : "-",
    elapsed: duration(value.elapsedMs), silence: duration(value.maxSilenceMs), headers: duration(value.headersMs), firstByte: duration(value.firstByteMs),
    build: typeof value.buildId === "string" && /^(?:[0-9a-f]{7,40}|development)$/u.test(value.buildId) ? value.buildId : "-",
    received: timestamp(value.receivedAt), occurred: timestamp(value.occurredAt) }];
});
console.log("\n## Browser Agent diagnostics (untrusted Browser observations)");
console.log("No conversation content, tokens, account IDs or correlation IDs are displayed. Request sent means fetch was initiated, not server arrival.");
console.log("| Received (UTC) | Browser time (UTC) | Code | Abort reason | Fetch started | HTTP | Elapsed (ms) | Max silence (ms) | Headers (ms) | First byte (ms) | Build |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const row of rows.sort((a, b) => b.received.localeCompare(a.received)).slice(0, 20)) console.log(`| ${[row.received, row.occurred, row.code, row.reason, row.sent, row.status, row.elapsed, row.silence, row.headers, row.firstByte, row.build].join(" | ")} |`);
if (!rows.length) console.log("| No matching events | - | - | - | - | - | - | - | - | - | - |");
function duration(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 600000 ? value : "-"; }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value))) return "-";
  return new Date(value).toISOString();
}
