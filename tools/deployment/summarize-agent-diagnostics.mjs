import { readFileSync } from "node:fs";

const [diagnosticPath, streamPath] = process.argv.slice(2);
if (!diagnosticPath || !streamPath) throw new Error("Expected diagnostic and stream event files");

const diagnostics = messages(diagnosticPath)
  .filter((value) => value.event === "agent_diagnostic")
  .map(({ phase, reason, incomplete, occurredAt }) => ({
    phase: text(phase),
    reason: text(reason),
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

console.log("## Agent production diagnostics (last 2 hours)");
console.log("");
console.log("Only bounded phase/reason/status fields are aggregated; conversation content and identifiers are excluded.");
console.log("");
table(
  ["Phase", "Reason", "Incomplete", "Count", "Latest (UTC)"],
  groupedDiagnostics(diagnostics),
);
console.log("");
table(["Stream event", "HTTP status", "Count", "Max latency (ms)"], groupedStreams(streams));

function messages(path) {
  const encoded = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(encoded)) throw new Error("Expected a JSON array of CloudWatch messages");
  return encoded.flatMap((message) => {
    if (typeof message !== "string") return [];
    try {
      const value = JSON.parse(message);
      return value && typeof value === "object" && !Array.isArray(value) ? [value] : [];
    } catch {
      return [];
    }
  });
}

function groupedDiagnostics(values) {
  const groups = new Map();
  for (const value of values) {
    const key = JSON.stringify([value.phase, value.reason, value.incomplete]);
    const current = groups.get(key) ?? { ...value, count: 0 };
    current.count += 1;
    if ((value.occurredAt ?? "") > (current.occurredAt ?? "")) current.occurredAt = value.occurredAt;
    groups.set(key, current);
  }
  return [...groups.values()]
    .sort((left, right) => (right.occurredAt ?? "").localeCompare(left.occurredAt ?? ""))
    .map((value) => [value.phase, value.reason, String(value.incomplete), String(value.count), value.occurredAt ?? "-"]);
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

function table(header, rows) {
  console.log(`| ${header.join(" | ")} |`);
  console.log(`| ${header.map(() => "---").join(" | ")} |`);
  if (rows.length === 0) console.log(`| ${["No matching events", ...header.slice(1).map(() => "-")].join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function text(value) {
  return typeof value === "string" && /^[a-z0-9_-]{1,64}$/u.test(value) ? value : "unknown";
}

function timestamp(value) {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
