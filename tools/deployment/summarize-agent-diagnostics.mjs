import { readFileSync } from "node:fs";
import { executionSummaryRows } from "./agent-execution-summary.mjs";

const [diagnosticPath, streamPath, modelShapePath, modelCallPath, invocationFailurePath, toolCallPath, replyValidationPath] = process.argv.slice(2);
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

if (modelCallPath) {
  console.log("\n### Model call failures (bounded metadata only)");
  const allowed = new Set(["Error", "ModelError", "ModelThrottledError", "MaxTokensError", "TypeError", "AbortError", "TimeoutError", "CancelledError", "ContextWindowOverflowError", "StructuredOutputError", "ValidationException", "AccessDeniedException", "ThrottlingException", "ServiceUnavailableException", "InternalServerException", "ModelTimeoutException", "ModelErrorException", "ModelNotReadyException", "ResourceNotFoundException", "CredentialsProviderError", "unclassified"]);
  const codes = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ERR_HTTP2_STREAM_CANCEL", "ERR_HTTP2_STREAM_ERROR", "ERR_HTTP2_INVALID_SESSION"]);
  const safeNumber = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max ? String(value) : "-";
  table(["At (UTC)", "Stage", "Call", "Elapsed (ms)", "Error", "Code", "Cause", "Cause code", "HTTP status", "AWS attempts", "Bundle throw sites"],
    [...messages(modelCallPath).filter(value => value.event === "agent_model_call" && value.outcome === "failed"), ...(invocationFailurePath ? messages(invocationFailurePath).filter(value => value.event === "agent_invocation_failed") : [])].slice(-10).map(value => [
      timestamp(value.occurredAt) ?? "-", value.event === "agent_invocation_failed" ? "invocation" : "model", safeNumber(value.modelCall, 1, 100), safeNumber(value.elapsedMs, 0, 300000),
      allowed.has(value.errorName) ? value.errorName : "unclassified", codes.has(value.errorCode) ? value.errorCode : "-",
      [1, 2, 3].map(depth => allowed.has(value[`cause${depth}Name`]) ? value[`cause${depth}Name`] : "-").join(" / "), [1, 2, 3].map(depth => codes.has(value[`cause${depth}Code`]) ? value[`cause${depth}Code`] : "-").join(" / "),
      safeNumber(["error", "cause1", "cause2", "cause3"].map(prefix => value[`${prefix}httpStatusCode`]).find(value => Number.isSafeInteger(value) && value >= 100 && value <= 599), 100, 599), safeNumber(["error", "cause1", "cause2", "cause3"].map(prefix => value[`${prefix}attempts`]).find(value => Number.isSafeInteger(value) && value >= 1 && value <= 10), 1, 10),
      ["error", "cause1", "cause2", "cause3"].map(prefix => `${safeNumber(value[`${prefix}BundleLine`], 1, 999999)}:${safeNumber(value[`${prefix}BundleColumn`], 1, 999999)}`).join(" / "),
    ]));
}

if (modelCallPath && invocationFailurePath) {
  console.log("\n### Failed or limited invocation steps (up to four latest)");
  const tools = new Set(["update_current_destination", "update_current_origin", "update_current_party", "update_current_travel_period", "update_current_budget", "consider_trip_scenario", "review_presented_candidates", "select_presented_candidate", "strands_structured_output", "explore_destination", "discover_destinations", "search_travel_knowledge", "search_weather_forecast", "search_place_media", "search_travel_alerts", "search_ground_access", "search_restaurants", "search_web", "read_web_pages", "resolve_place_candidates", "schedule_trip_recheck", "search_accommodations", "search_journeys", "search_representative_timetable", "compare_journeys", "draft_itinerary", "get_trip_search_context", "search_trip_gap_restaurants", "search_trip_gap_places", "search_trip_gap_ground_routes", "search_rail_bus_connections", "propose_trip_item_change"]);
  const codes = new Set(["invalid_input", "precondition_failed", "unknown_tool", "not_found", "outside_coverage", "precondition_missing", "stale_revision", "permission_denied", "rate_limited", "unavailable", "ambiguous_entity", "execution_failed", "intent_unavailable", "tool_budget", "schema_invalid", "invalid_condition", "invalid_source", "condition_conflict", "evidence_collision", "invalid_proposal", "missing_evidence", "ineligible_evidence", "invalid_field", "known_condition", "invalid_question_target", "operation_available", "invalid_receipt", "unsafe_content"]);
  const kinds = new Set(["answer", "candidates", "conversation", "clarification", "unavailable", "operation_result", "uncertainty"]);
  const number = value => Number.isSafeInteger(value) && value >= 0 && value <= 20_000_000 ? String(value) : "not_recorded";
  const seen = new Set();
  const failures = [...messages(invocationFailurePath).filter(value => value.event === "agent_invocation_failed" && typeof value.executionId === "string"),
    ...limitedExecutions(diagnosticMessages)].sort((a, b) => (b.occurredAt ?? "").localeCompare(a.occurredAt ?? ""))
    .filter(value => !seen.has(value.executionId) && seen.add(value.executionId)).slice(0, 4);
  const steps = [...messages(modelCallPath).filter(value => value.event === "agent_model_call"),
    ...(toolCallPath ? messages(toolCallPath).filter(value => value.event === "agent_tool_call") : []),
    ...(replyValidationPath ? messages(replyValidationPath).filter(value => value.event === "agent_reply_validation") : [])];
  table(["Stopped (UTC)", "At (UTC)", "Call", "Stage", "Outcome", "Tools / reply kind", "Code", "Elapsed (ms)", "Output tokens", "Reasoning blocks", "Evidence collisions", "Conflicting observations"],
    failures.flatMap(failure => steps.filter(value => value.executionId === failure.executionId)
      .sort((a, b) => (a.occurredAt ?? "").localeCompare(b.occurredAt ?? "")).slice(0, 80).map(value => [
        timestamp(failure.occurredAt) ?? "-", timestamp(value.occurredAt) ?? "-", number(value.modelCall),
        value.event === "agent_model_call" ? "model" : value.event === "agent_tool_call" ? "tool" : "reply_validation",
        ["completed", "failed", "rejected"].includes(value.outcome) ? value.outcome : "not_recorded",
        value.event === "agent_model_call" ? (Array.isArray(value.tools) ? value.tools.slice(0, 32).map(name => tools.has(name) ? name : "unknown_tool").join(", ") || "none" : "not_recorded") :
          value.event === "agent_tool_call" ? tools.has(value.tool) ? value.tool : "unknown_tool" : kinds.has(value.replyKind) ? value.replyKind : "unknown",
        codes.has(value.code) ? value.code : "-", number(value.elapsedMs), number(value.outputTokens), number(value.reasoningBlocks), number(value.collisionCount), number(value.conflictCount),
      ])));
  console.log("\n### Reply reference membership (same failed or limited invocations)");
  table(["Stopped (UTC)", "Call", "Outcome", "Code", "Evidence", "Retained", "Omitted", "Reply references", "Unknown references", "Omitted references", "Duplicate references"],
    failures.flatMap(failure => steps.filter(value => value.executionId === failure.executionId && value.event === "agent_reply_validation")
      .sort((a, b) => (a.occurredAt ?? "").localeCompare(b.occurredAt ?? "")).slice(0, 80).map(value => [
        timestamp(failure.occurredAt) ?? "-", number(value.modelCall),
        ["completed", "failed", "rejected"].includes(value.outcome) ? value.outcome : "not_recorded", codes.has(value.code) ? value.code : "-",
        ...["evidenceCount", "retainedEvidenceCount", "omittedEvidenceCount", "referenceCount", "unknownReferenceCount", "omittedReferenceCount", "duplicateReferenceCount"].map(key => number(value[key])),
      ])));
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
    /^(?:v2:turn_input:(?:invalid_input|unresolved_intent|context_budget)|v2:(?:agent_invoke|intent_state|read_tool|runtime_projection|runner):(?:abort|timeout|provider|validation|unknown)|v2:publication:(?:incomplete_execution|missing_reply_proposal|missing_structured_output|evidence_collision|response_budget|invalid_claim_binding|invalid_proposal|missing_evidence|ineligible_evidence|invalid_field|known_condition|operation_available|invalid_receipt|unsafe_content))$/u.test(value)
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
