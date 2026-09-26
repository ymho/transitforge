import { readFileSync } from "node:fs";

const [diagnosticPath, streamPath, modelShapePath] = process.argv.slice(2);
if (!diagnosticPath || !streamPath) throw new Error("Expected diagnostic and stream event files");

const diagnostics = messages(diagnosticPath)
  .filter((value) => value.event === "agent_diagnostic")
  .map(({ phase, reason, mode, incomplete, occurredAt }) => ({
    phase: text(phase),
    reason: text(reason),
    mode: diagnosticMode(mode),
    incomplete: incomplete === true,
    occurredAt: timestamp(occurredAt),
  }));
const streams = messages(streamPath)
  .filter((value) => value.eventSource === "agent_stream")
  .map(({ event, status, latencyMs }) => ({
    event: text(event),
    status: Number.isSafeInteger(status) ? status : undefined,
    latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : undefined,
  }));
const modelShapes = modelShapePath ? messages(modelShapePath)
  .filter((value) => value.event === "agent_model_response_rejected")
  .map(({ reason, kinds, contentCount }) => ({
    reason: text(reason),
    kinds: Array.isArray(kinds) ? kinds.map(text).slice(0, 13).join(",") : "unknown",
    contentCount: Number.isSafeInteger(contentCount) && contentCount >= 0 ? contentCount : undefined,
  })) : [];

console.log("## Agent production diagnostics (last 2 hours)");
console.log("");
console.log("Only bounded phase/reason/status fields are aggregated; conversation content and identifiers are excluded.");
console.log("");
table(
  ["Phase", "Reason", "Mode", "Incomplete", "Count", "Latest (UTC)"],
  groupedDiagnostics(diagnostics),
);
console.log("");
table(["Stream event", "HTTP status", "Count", "Max latency (ms)"], groupedStreams(streams));
if (modelShapePath) {
  console.log("");
  table(["Model response rejection", "Block kinds", "Count", "Max blocks"], groupedModelShapes(modelShapes));
}

function messages(path) {
  const encoded = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(encoded)) throw new Error("Expected a JSON array of CloudWatch messages");
  return encoded.flatMap((message) => {
    if (typeof message !== "string") return [];
    const value = decodedMessage(message);
    return value ? [value] : [];
  });
}

function decodedMessage(message) {
  const candidates = [message, message.slice(Math.max(0, message.indexOf("{")))];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      if (typeof value.message === "string") return decodedMessage(value.message) ?? value;
      return value;
    } catch {
      // Lambda plain-text logs prefix console output with timestamp, request ID and level.
    }
  }
  return undefined;
}

function groupedDiagnostics(values) {
  const groups = new Map();
  for (const value of values) {
    const key = JSON.stringify([value.phase, value.reason, value.mode, value.incomplete]);
    const current = groups.get(key) ?? { ...value, count: 0 };
    current.count += 1;
    if ((value.occurredAt ?? "") > (current.occurredAt ?? "")) current.occurredAt = value.occurredAt;
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((left, right) => (right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""))
    .map((value) => [value.phase, value.reason, value.mode ?? "-", String(value.incomplete), String(value.count), value.occurredAt ?? "-"]);
}

function groupedStreams(values) {
  const groups = new Map();
  for (const value of values) {
    const key = JSON.stringify([value.event, value.status]);
    const current = groups.get(key) ?? { ...value, count: 0 };
    current.count += 1;
    current.latencyMs = Math.max(current.latencyMs ?? 0, value.latencyMs ?? 0);
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((left, right) => left.event.localeCompare(right.event))
    .map((value) => [value.event, value.status === undefined ? "-" : String(value.status), String(value.count), value.latencyMs === undefined ? "-" : String(value.latencyMs)]);
}

function groupedModelShapes(values) {
  const groups = new Map();
  for (const value of values) {
    const key = JSON.stringify([value.reason, value.kinds]);
    const current = groups.get(key) ?? { ...value, count: 0 };
    current.count += 1;
    current.contentCount = Math.max(current.contentCount ?? 0, value.contentCount ?? 0);
    groups.set(key, current);
  }
  return [...groups.values()].map((value) => [value.reason, value.kinds, String(value.count), String(value.contentCount ?? "-")]);
}

function table(header, rows) {
  console.log(`| ${header.join(" | ")} |`);
  console.log(`| ${header.map(() => "---").join(" | ")} |`);
  if (rows.length === 0) console.log(`| ${["No matching events", ...header.slice(1).map(() => "-")].join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function text(value) {
  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/u.test(value) ? value : "unknown";
}

function diagnosticMode(value) {
  return typeof value === "string" &&
    /^v2:(?:agent_invoke|intent_state|read_tool|runtime_projection|runner):(?:abort|timeout|provider|validation|unknown)$/u.test(value)
    ? value
    : undefined;
}

function timestamp(value) {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
