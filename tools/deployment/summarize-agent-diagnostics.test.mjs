import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "raiquora-agent-diagnostics-"));
const diagnostics = join(directory, "diagnostics.json");
const streams = join(directory, "streams.json");
const modelShapes = join(directory, "model-shapes.json");
writeFileSync(diagnostics, JSON.stringify([
  `2026-09-24T12:00:00.000Z\trequest-id\tINFO\t${JSON.stringify({ event: "agent_diagnostic", executionId: "private-id", phase: "runtime", reason: "schema_invalid", mode: "v2:agent_invoke:provider", incomplete: true, occurredAt: "2026-09-24T12:00:00Z" })}`,
  "not-json",
]));
writeFileSync(streams, JSON.stringify([
  JSON.stringify({ timestamp: "2026-09-24T12:00:00.000Z", level: "INFO", message: JSON.stringify({ eventSource: "agent_stream", event: "error", requestId: "private-id", latencyMs: 321 }) }),
]));
writeFileSync(modelShapes, JSON.stringify([
  JSON.stringify({ event: "agent_model_response_rejected", reason: "text_empty", kinds: ["reasoning", "text"], contentCount: 2, privateText: "private-provider-response" }),
]));

const result = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams, modelShapes], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /runtime \| schema_invalid \| v2:agent_invoke:provider \| true \| 1/);
assert.match(result.stdout, /error \| - \| 1 \| 321/);
assert.match(result.stdout, /text_empty \| reasoning,text \| 1 \| 2/);
assert.doesNotMatch(result.stdout, /private-id|not-json|private-provider-response/);

writeFileSync(diagnostics, JSON.stringify([
  JSON.stringify({ event: "agent_diagnostic", phase: "runtime", reason: "failed", mode: "private:secret", incomplete: true, occurredAt: "2026-09-24T12:00:01Z" }),
]));
const unsafe = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams], { encoding: "utf8" });
assert.equal(unsafe.status, 0, unsafe.stderr);
assert.match(unsafe.stdout, /runtime \| failed \| - \| true \| 1/);
assert.doesNotMatch(unsafe.stdout, /private:secret/);

writeFileSync(diagnostics, JSON.stringify(["context_budget", "invalid_input", "unresolved_intent", "private-input"].map(kind =>
  JSON.stringify({ event: "agent_diagnostic", phase: "runtime", reason: "failed", mode: `v2:turn_input:${kind}`, incomplete: true, occurredAt: "2026-10-04T10:14:01Z" }))));
const inputFailures = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams], { encoding: "utf8" });
assert.equal(inputFailures.status, 0, inputFailures.stderr);
assert.match(inputFailures.stdout, /v2:turn_input:context_budget/);
assert.match(inputFailures.stdout, /v2:turn_input:invalid_input/);
assert.match(inputFailures.stdout, /v2:turn_input:unresolved_intent/);
assert.doesNotMatch(inputFailures.stdout, /private-input/);

writeFileSync(diagnostics, JSON.stringify([
  JSON.stringify({ event: "agent_diagnostic", phase: "runtime", reason: "failed", mode: "v2:publication:missing_reply_proposal", incomplete: true, occurredAt: "2026-09-24T12:00:02Z" }),
]));
const publication = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams], { encoding: "utf8" });
assert.equal(publication.status, 0, publication.stderr);
assert.match(publication.stdout, /v2:publication:missing_reply_proposal/);

writeFileSync(diagnostics, JSON.stringify([
  JSON.stringify({ event: "agent_diagnostic", phase: "execution", reason: "output_token_budget", executionId: "private-id", occurredAt: "2026-10-03T07:37:16Z" }),
  JSON.stringify({ event: "agent_diagnostic", phase: "tool", executionId: "private-id", reason: "failed", refs: ["draft_itinerary"], toolErrorCode: "invalid_input", occurredAt: "2026-10-03T07:37:10Z", input: "private-input" }),
  JSON.stringify({ event: "agent_diagnostic", phase: "tool", executionId: "private-id", reason: "failed", refs: ["draft_itinerary"], toolErrorCode: "private-error", occurredAt: "2026-10-03T07:37:15Z" }),
]));
const limited = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams], { encoding: "utf8" });
assert.equal(limited.status, 0, limited.stderr);
assert.match(limited.stdout, /draft_itinerary \| failed \| invalid_input/);
assert.match(limited.stdout, /draft_itinerary \| failed \| not_recorded/);
assert.doesNotMatch(limited.stdout, /private-id|private-input|private-error/);

writeFileSync(diagnostics, JSON.stringify([
  JSON.stringify({ event: "agent_diagnostic", phase: "execution", reason: "completed", executionId: "private-id", occurredAt: "2026-10-04T08:28:16Z" }),
  ...[1, 2].map(second => JSON.stringify({ event: "agent_diagnostic", phase: "tool", executionId: "private-id", reason: "failed", refs: ["draft_itinerary"], toolErrorCode: "unavailable", occurredAt: `2026-10-04T08:28:0${second}Z`, input: "private-input" })),
]));
const completedFailures = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams], { encoding: "utf8" });
assert.equal(completedFailures.status, 0, completedFailures.stderr);
assert.match(completedFailures.stdout, /draft_itinerary \| unavailable \| 2 \| 2026-10-04T08:28:02.000Z/);
assert.doesNotMatch(completedFailures.stdout, /private-id|private-input/);

const modelCalls = join(directory, "model-calls.json");
writeFileSync(modelCalls, JSON.stringify([
  JSON.stringify({ event: "agent_model_call", outcome: "failed", occurredAt: "2026-10-11T05:16:02Z", modelCall: 1, elapsedMs: 59000, errorName: "Error", cause1Name: "Error", cause1Code: "ECONNRESET", cause1httpStatusCode: 503, cause1attempts: 3, message: "private-provider-message", executionId: "private-id" }),
  JSON.stringify({ event: "agent_model_call", outcome: "failed", errorName: "private-error", errorCode: "private-code", elapsedMs: -1, errorhttpStatusCode: 999 }),
]));
const modelFailures = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams, modelShapes, modelCalls], { encoding: "utf8" });
assert.equal(modelFailures.status, 0, modelFailures.stderr);
assert.match(modelFailures.stdout, /59000 \| Error \| - \| Error \/ - \/ - \| ECONNRESET \/ - \/ - \| 503 \| 3/);
assert.doesNotMatch(modelFailures.stdout, /private-provider-message|private-id|private-error|private-code|999/);

const failures = join(directory, "failures.json"), toolCalls = join(directory, "tool-calls.json"), validations = join(directory, "validations.json");
const encode = values => JSON.stringify(values.map(value => JSON.stringify(value)));
writeFileSync(failures, encode([{ event: "agent_invocation_failed", executionId: "private-id", occurredAt: "2026-10-11T06:10:07Z" }]));
writeFileSync(toolCalls, encode([{ event: "agent_tool_call", executionId: "private-id", occurredAt: "2026-10-11T06:09:00Z",
  modelCall: 2, tool: "explore_destination", outcome: "rejected", code: "stale_revision", input: "private-input" },
{ event: "agent_tool_call", executionId: "private-id", tool: "private-tool", outcome: "private-outcome", code: "private-code" }]));
writeFileSync(validations, encode([{ event: "agent_reply_validation", executionId: "private-id", occurredAt: "2026-10-11T06:09:30Z",
  modelCall: 4, replyKind: "answer", outcome: "rejected", code: "invalid_field", reply: "private-reply" }]));
const timeline = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams, modelShapes, modelCalls, failures, toolCalls, validations], { encoding: "utf8" });
assert.equal(timeline.status, 0, timeline.stderr);
assert.match(timeline.stdout, /tool \| rejected \| explore_destination \| stale_revision/);
assert.match(timeline.stdout, /reply_validation \| rejected \| answer \| invalid_field/);
assert.doesNotMatch(timeline.stdout, /private-id|private-input|private-tool|private-outcome|private-code|private-reply/);

// A native SDK output budget stop returns normally, without an invocation-failed event.
writeFileSync(failures, encode([]));
writeFileSync(diagnostics, encode([{ event: "agent_diagnostic", executionId: "private-id", phase: "execution",
  reason: "output_token_budget", occurredAt: "2026-10-11T06:44:03Z" }]));
writeFileSync(validations, encode([{ event: "agent_reply_validation", executionId: "private-id", occurredAt: "2026-10-11T06:43:30Z",
  modelCall: 7, replyKind: "uncertainty", outcome: "rejected", code: "evidence_collision", collisionCount: 0, conflictCount: 2,
  observations: ["private-observation"], reply: "private-reply" }]));
const budgetTimeline = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams, modelShapes, modelCalls, failures, toolCalls, validations], { encoding: "utf8" });
assert.equal(budgetTimeline.status, 0, budgetTimeline.stderr);
assert.match(budgetTimeline.stdout, /Failed or limited invocation steps/);
assert.match(budgetTimeline.stdout, /2026-10-11T06:44:03.000Z \| 2026-10-11T06:43:30.000Z \| 7 \| reply_validation \| rejected \| uncertainty \| evidence_collision \| not_recorded \| not_recorded \| not_recorded \| 0 \| 2/);
assert.doesNotMatch(budgetTimeline.stdout, /private-id|private-observation|private-reply/);

writeFileSync(validations, encode([{ event: "agent_reply_validation", executionId: "private-id", occurredAt: "2026-10-11T06:43:30Z",
  modelCall: 7, replyKind: "answer", outcome: "rejected", code: "missing_evidence",
  evidenceCount: 21, retainedEvidenceCount: 20, omittedEvidenceCount: 1, referenceCount: 2,
  unknownReferenceCount: 0, omittedReferenceCount: 1, duplicateReferenceCount: 0, referenceIds: ["private-reference"] }]));
const membership = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams, modelShapes, modelCalls, failures, toolCalls, validations], { encoding: "utf8" });
assert.equal(membership.status, 0, membership.stderr);
assert.match(membership.stdout, /2026-10-11T06:44:03.000Z \| 7 \| rejected \| missing_evidence \| 21 \| 20 \| 1 \| 2 \| 0 \| 1 \| 0/);
assert.doesNotMatch(membership.stdout, /private-reference|private-id/);

// A browser can fail even when the server saves and sends its final response.
// Keep the successful model/Tool timeline visible without publishing identifiers or payloads.
writeFileSync(diagnostics, encode([{ event: "agent_diagnostic", executionId: "private-completed-id", phase: "execution",
  reason: "completed", occurredAt: "2026-10-11T07:56:11Z" }]));
writeFileSync(modelCalls, encode([{ event: "agent_model_call", executionId: "private-completed-id", occurredAt: "2026-10-11T07:55:00Z",
  modelCall: 1, outcome: "completed", tools: ["search_journeys"], elapsedMs: 1000, outputTokens: 100, prompt: "private-prompt" }]));
writeFileSync(toolCalls, encode([{ event: "agent_tool_call", executionId: "private-completed-id", occurredAt: "2026-10-11T07:56:00Z",
  modelCall: 1, tool: "search_journeys", outcome: "completed", result: "private-result" }]));
writeFileSync(streams, JSON.stringify([
  { timestamp: Date.parse("2026-10-11T07:56:11Z"), message: JSON.stringify({ eventSource: "agent_stream", event: "final_sent",
    latencyMs: 73000, requestId: "private-completed-id" }) },
  { timestamp: Date.parse("2026-10-11T07:56:12Z"), message: JSON.stringify({ eventSource: "agent_stream", event: "completed",
    latencyMs: 73100, requestId: "private-completed-id" }) },
  { timestamp: "private-timestamp", message: JSON.stringify({ eventSource: "agent_stream", event: "private-event" }) },
]));
const successful = spawnSync(process.execPath, ["tools/deployment/summarize-agent-diagnostics.mjs", diagnostics, streams, modelShapes, modelCalls, failures, toolCalls, validations], { encoding: "utf8" });
assert.equal(successful.status, 0, successful.stderr);
assert.match(successful.stdout, /Latest completed invocation steps/);
assert.match(successful.stdout, /2026-10-11T07:56:11.000Z \| 2026-10-11T07:55:00.000Z \| 1 \| model \| completed \| search_journeys/);
assert.match(successful.stdout, /2026-10-11T07:56:11.000Z \| final_sent \| - \| 73000/);
assert.match(successful.stdout, /2026-10-11T07:56:12.000Z \| completed \| - \| 73100/);
assert.doesNotMatch(successful.stdout, /private-completed-id|private-prompt|private-result|private-timestamp|private-event/);
