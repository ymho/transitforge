import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
test("diagnostic collection uses the existing Terraform personal-state log group", () => {
  const workflow = readFileSync(".github/workflows/agent-production-diagnostics.yml", "utf8");
  const agent = workflow.match(/AGENT_STREAM_LOG_GROUP: (\S+)/u)?.[1], personal = workflow.match(/PERSONAL_STATE_LOG_GROUP: (\S+)/u)?.[1];
  assert.equal(personal, `${agent}-personal-state`);
  assert.match(readFileSync("infra/terraform/environments/dev/agent-stream.tf", "utf8"), /name\s*=\s*"\/aws\/lambda\/\$\{local.agent_stream_name\}-personal-state"/u);
});

test("summarizes Browser observations with closed codes and bounded metrics, never content or identifiers", () => {
  const directory = mkdtempSync(join(tmpdir(), "browser-diagnostics-"));
  try {
    const file = join(directory, "logs.json"), report = { eventSource: "browser_agent_diagnostic", code: "aborted", abortReason: "idle_timeout", requestSent: true, elapsedMs: 45000, maxSilenceMs: 45000, buildId: "e0d06e68", receivedAt: "2026-10-11T08:00:00.000Z", occurredAt: "2026-10-11T07:59:59.000Z", diagnosticId: "PRIVATE_ID", runId: "PRIVATE_RUN", token: "PRIVATE_TOKEN", userRequest: "PRIVATE_TEXT" };
    writeFileSync(file, JSON.stringify([`2026-10-11 INFO ${JSON.stringify(report)}`, JSON.stringify({ ...report, code: "PRIVATE_CODE" }), JSON.stringify({ ...report, abortReason: "PRIVATE_REASON", buildId: "PRIVATE_BUILD", elapsedMs: -1, maxSilenceMs: 600001, httpStatus: 999, receivedAt: "PRIVATE_DATE" })]));
    const result = spawnSync(process.execPath, ["tools/deployment/summarize-browser-agent-diagnostics.mjs", file], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /aborted \| idle_timeout \| true \| - \| 45000 \| 45000/);
    assert.doesNotMatch(result.stdout, /PRIVATE|600001|999/);
  } finally { rmSync(directory, { recursive: true }); }
});
