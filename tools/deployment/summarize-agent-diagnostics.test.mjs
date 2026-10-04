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
