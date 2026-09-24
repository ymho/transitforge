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
  `2026-09-24T12:00:00.000Z\trequest-id\tINFO\t${JSON.stringify({ event: "agent_diagnostic", executionId: "private-id", phase: "runtime", reason: "schema_invalid", incomplete: true, occurredAt: "2026-09-24T12:00:00Z" })}`,
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
assert.match(result.stdout, /runtime \| schema_invalid \| true \| 1/);
assert.match(result.stdout, /error \| - \| 1 \| 321/);
assert.match(result.stdout, /text_empty \| reasoning,text \| 1 \| 2/);
assert.doesNotMatch(result.stdout, /private-id|not-json|private-provider-response/);
