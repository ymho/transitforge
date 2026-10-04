import { readFileSync } from "node:fs";
import { executionSummaryRows } from "./agent-execution-summary.mjs";

const [diagnosticPath, streamPath, modelShapePath] = process.argv.slice(2);
if (!diagnosticPath || !streamPath) throw new Error("Expected diagnostic and stream event files");

const diagnosticMessages = messages(diagnosticPath).filter((value) => value.event === "agent_diagnostic");
const diagnostics = diagnosticMessages
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
console.log("Only bounded phase/reason/status fields and numeric usage are aggregated; conversation content and identifiers are excluded.");
console.log("");
table(
  ["Phase", "Reason", "Mode", "Incomplete", "Count", "Latest (UTC)"],
  groupedDiagnostics(diagnostics),
);
console.log("");
console.log("### Tool failures (including completed executions)");
table(["Tool", "Error code", "Count", "Latest (UTC)"], failedToolRows(diagnosticMessages));
console.log("");
console.log("### Execution termination (separate from reply publication)");
console.log("Usage cells show maximum (measured samples / group samples), not sums or percentiles. not_recorded is not zero. Legacy logs cannot reconstruct missing usage.");
table(["Reason", "Stop reason", "Local limit", "Samples", "Model calls", "Read Tool calls", "Condition Tool calls", "Structured output calls", "Input tokens", "Output tokens", "Total tokens", "Latest (UTC)"],
  executionSummaryRows(diagnosticMessages));
console.log("");
table(["Stream event", "HTTP status", "Count", "Max latency (ms)"], groupedStreams(streams));
console.log("");
console.log("### Limited executions (up to four latest)");
console.log("Execution IDs and conversation content are omitted. Only bounded counts and registered Tool names are displayed.");
table(["Stopped (UTC)", "Model calls", "Read calls", "Condition calls", "Structured calls", "Input tokens", "Output tokens"],
  limitedExecutionRows(diagnosticMessages));
table(["Stopped (UTC)", "Step", "Tool", "Outcome", "Error code", "At (UTC)"], limitedToolRows(diagnosticMessages));
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
    /^(?:v2:(?:agent_invoke|intent_state|read_tool|runtime_projection|runner):(?:abort|timeout|provider|validation|unknown)|v2:publication:(?:incomplete_execution|missing_reply_proposal|missing_structured_output|evidence_collision|response_budget|invalid_claim_binding|invalid_proposal|missing_evidence|ineligible_evidence|invalid_field|known_condition|operation_available|invalid_receipt|unsafe_content))$/u.test(value)
    ? value
    : undefined;
}

function timestamp(value) {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function limitedExecutions(events) {
  return events.filter(event => event.phase === "execution" && ["iteration_budget", "output_token_budget", "total_token_budget", "model_output_limit", "context_window_limit", "tool_budget", "deadline"].includes(event.reason) &&
    typeof event.executionId === "string" && event.executionId.length > 0)
    .sort((left, right) => (right.occurredAt ?? "").localeCompare(left.occurredAt ?? "")).slice(0, 4);
}

function diagnosticCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : "not_recorded";
}

function limitedExecutionRows(events) {
  return limitedExecutions(events).map(event => [
    timestamp(event.occurredAt) ?? "-", ...["modelCalls", "toolCalls", "conditionToolCalls",
      "structuredOutputCalls", "inputTokens", "outputTokens"].map(name => diagnosticCount(event.counts?.[name]))
  ]);
}

function limitedToolRows(events) {
  return limitedExecutions(events).flatMap(stopped =>
    events.filter(event => event.executionId === stopped.executionId && event.phase === "tool")
      .sort((left, right) => (left.occurredAt ?? "").localeCompare(right.occurredAt ?? ""))
      .slice(0, 32).map((event, index) => [
        timestamp(stopped.occurredAt) ?? "-", String(index + 1), text(event.refs?.[0]),
        text(event.reason), toolError(event.toolErrorCode), timestamp(event.occurredAt) ?? "-"
      ]));
}

function toolError(value) {
  return ["invalid_input", "precondition_failed", "unknown_tool", "not_found", "outside_coverage", "precondition_missing", "stale_revision", "permission_denied", "rate_limited", "unavailable", "ambiguous_entity", "execution_failed"].includes(value) ? value : "not_recorded";
}

function failedToolRows(events) {
  const groups = new Map();
  for (const event of events) {
    if (event.phase !== "tool" || event.reason !== "failed") continue;
    const name = text(event.refs?.[0]), code = toolError(event.toolErrorCode), at = timestamp(event.occurredAt) ?? "-";
    const key = JSON.stringify([name, code]), group = groups.get(key) ?? { name, code, count: 0, at: "-" };
    group.count++;
    if (at > group.at) group.at = at;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 32)
    .map(group => [group.name, group.code, String(group.count), group.at]);
}
