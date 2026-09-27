import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executionSummaryRows } from "./agent-execution-summary.mjs";

const event = (overrides = {}) => ({ event: "agent_diagnostic", phase: "execution", reason: "output_token_budget",
  stopReason: "limitOutputTokens", occurredAt: "2026-09-27T00:00:00Z", ...overrides });

test("aggregates maxima with measurement coverage, preserving a real zero", () => {
  const rows = executionSummaryRows([
    event({ counts: { modelCalls: 2, toolCalls: 0, outputTokens: 4800 } }),
    event({ counts: { modelCalls: 4, outputTokens: 5000 }, occurredAt: "2026-09-27T00:00:02Z" }),
    event(),
  ]);
  assert.deepEqual(rows, [["output_token_budget", "limitOutputTokens", "-", "3", "4 (2/3)", "0 (1/3)",
    "not_recorded (0/3)", "5000 (2/3)", "not_recorded (0/3)", "2026-09-27T00:00:02.000Z"]]);
});

test("keeps deadline, local Tool cap and per-call output cap distinct from cumulative output", () => {
  const rows = executionSummaryRows([
    event(), event({ reason: "deadline", stopReason: "cancelled", limitReason: "deadline" }),
    event({ reason: "tool_budget", stopReason: "endTurn", limitReason: "tool_calls" }),
    event({ reason: "model_output_limit", stopReason: "maxTokens" }),
  ]);
  assert.equal(rows.length, 4);
  assert.ok(rows.some(row => row[0] === "deadline" && row[2] === "deadline"));
  assert.ok(rows.some(row => row[0] === "model_output_limit" && row[1] === "maxTokens"));
});

test("does not reconstruct execution counts from old runtime or per-Tool events", () => {
  assert.deepEqual(executionSummaryRows([
    event({ phase: "runtime", reason: "failed", counts: { outputTokens: 8000 } }),
    event({ phase: "tool", reason: "completed" }),
  ]), []);
  const rows = executionSummaryRows([event({ reason: "failed", stopReason: undefined })]);
  assert.equal(rows[0][1], "not_recorded");
  assert.ok(rows[0].includes("not_recorded (0/1)"));
});

test("rejects arbitrary strings and invalid numbers without retaining payloads", () => {
  const rows = executionSummaryRows([event({
    reason: "PRIVATE_REASON", stopReason: "PRIVATE_STOP", limitReason: "PRIVATE_LIMIT", occurredAt: "PRIVATE_DATE",
    counts: { modelCalls: -1, toolCalls: "PRIVATE_COUNT", inputTokens: Infinity, outputTokens: NaN,
      totalTokens: 1.5, extra: "PRIVATE_EXTRA" },
    executionId: "PRIVATE_ID", userRequest: "PRIVATE_MESSAGE", refs: ["PRIVATE_URL"], lastMessage: "PRIVATE_REPLY",
  })]);
  assert.equal(rows[0][0], "unknown");
  assert.equal(rows[0][1], "unknown");
  assert.ok(!JSON.stringify(rows).includes("PRIVATE"));
  for (const cell of rows[0].slice(4, 9)) assert.equal(cell, "not_recorded (0/1)");
});

test("the real CLI reads Lambda-prefixed and wrapped logs but publishes only the diagnostic projection", () => {
  const directory = mkdtempSync(join(tmpdir(), "execution-summary-"));
  try {
    const diagnostics = join(directory, "diagnostics.json"), streams = join(directory, "streams.json");
    const value = event({ executionId: "PRIVATE_EXECUTION", userRequest: "PRIVATE_REQUEST", profile: "PRIVATE_PROFILE",
      counts: { modelCalls: 2, toolCalls: 2, inputTokens: 200, outputTokens: 4800, totalTokens: 5000 } });
    writeFileSync(diagnostics, JSON.stringify([
      `2026-09-27T00:00:00Z\tPRIVATE_LAMBDA_ID\tINFO\t${JSON.stringify(value)}`,
      JSON.stringify({ message: JSON.stringify(event({ reason: "failed", stopReason: "not_recorded" })) }),
      JSON.stringify({ event: "agent_diagnostic", phase: "runtime", reason: "failed",
        mode: "v2:publication:incomplete_execution" }),
    ]));
    writeFileSync(streams, "[]");
    const output = execFileSync(process.execPath, [new URL("./summarize-agent-diagnostics.mjs", import.meta.url).pathname,
      diagnostics, streams], { encoding: "utf8" });
    assert.match(output, /output_token_budget \| limitOutputTokens \| - \| 1 \| 2 \(1\/1\) \| 2 \(1\/1\) \| 200 \(1\/1\) \| 4800 \(1\/1\) \| 5000 \(1\/1\)/);
    assert.match(output, /not_recorded \(0\/1\)/);
    assert.match(output, /v2:publication:incomplete_execution/);
    assert.ok(!output.includes("PRIVATE"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
