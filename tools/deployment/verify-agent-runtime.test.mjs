import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifyAgentRuntime } from "./verify-agent-runtime.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = fileURLToPath(new URL("./verify-agent-runtime.mjs", import.meta.url));
const workflow = readFileSync(new URL("../../.github/workflows/cd.yml", import.meta.url), "utf8");
const environment = { TF_VAR_agent_runtime_v2_enabled: "true", TF_VAR_conversation_semantic_kernel_enabled: "false" };
const active = { state: "Active", updateStatus: "Successful", v2: "true", semantic: "false" };
const step = workflow.match(/      - name: Verify deployed Agent runtime\n([\s\S]*?)(?=\n      - name:)/u)?.[1];
assert.ok(step, "CD must verify the active runtime after apply");
const shell = step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /u, "")).join("\n");

// Public AWS response fixtures only. No real AWS requests are made in this suite.
for (const v2 of ["true", "false"]) {
  test(`verifies explicit v2=${v2}, including a deliberate rollback`, () => {
    assert.equal(verifyAgentRuntime({ ...active, v2 }, { ...environment, TF_VAR_agent_runtime_v2_enabled: v2 }),
      `Agent runtime verified: v2=${v2}; semantic=false; state=Active; update=Successful.\n`);
  });
}
for (const [label, change] of [
  ["old runtime", { v2: "false" }], ["missing flag", { v2: null }],
  ["semantic unexpectedly enabled", { semantic: "true" }],
  ["still updating", { updateStatus: "InProgress" }], ["failed update", { updateStatus: "Failed" }],
  ["inactive function", { state: "Inactive" }], ["wrong flag type", { v2: true }],
]) {
  test(`rejects ${label}`, () => assert.throws(() => verifyAgentRuntime({ ...active, ...change }, environment)));
}
test("does not silently default missing or invalid expected flags", () => {
  for (const value of [undefined, "yes", true, ""]) {
    assert.throws(() => verifyAgentRuntime(active, { ...environment, TF_VAR_agent_runtime_v2_enabled: value }));
  }
  assert.throws(() => verifyAgentRuntime(active, { TF_VAR_agent_runtime_v2_enabled: "true" }));
});
test("never publishes unexpected payload fields or invalid input", () => {
  const canary = "private-canary-706-do-not-print";
  assert.ok(!verifyAgentRuntime({ ...active, Environment: { Secret: canary } }, environment).includes(canary));
  for (const input of [`{${canary}`, "null", "x".repeat(9000)]) {
    const result = spawnSync(process.execPath, [script], { input, encoding: "utf8", env: { ...process.env, ...environment } });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Agent runtime verification failed; inspect the deployment state and selected flags.\n");
  }
});
test("CD explicitly selects V2 without enabling old semantic interpretation", () => {
  assert.match(workflow, /^      TF_VAR_agent_runtime_v2_enabled: "true"$/mu);
  assert.match(workflow, /^      TF_VAR_conversation_semantic_kernel_enabled: "false"$/mu);
  assert.ok(workflow.indexOf("Apply validated Terraform plan") < workflow.indexOf("Verify deployed Agent runtime"));
  assert.match(step, /if: env.CD_MODE == 'deploy'/u);
  assert.match(workflow, /terraform output -raw agent_stream_function_name/u);
  assert.match(shell, /set -euo pipefail/u);
  assert.match(shell, /--query '\{state:State,updateStatus:LastUpdateStatus,v2:Environment\.Variables\.AGENT_RUNTIME_V2_ENABLED,semantic:Environment\.Variables\.SEMANTIC_INTENT_ENABLED\}'/u);
});
for (const mode of ["success", "read-failure", "wrong-config"]) {
  test(`executes the actual CD verification shell: ${mode}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-runtime-706-"));
    try {
      const log = join(directory, "aws-calls.jsonl"), summary = join(directory, "summary.md");
      const mock = `#!${process.execPath}\n` + `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_AWS_LOG, JSON.stringify(args) + "\\n");
if (args[0] !== "lambda") process.exit(20);
if (args[1] === "wait" && args[2] === "function-updated-v2") process.exit(0);
if (args[1] !== "get-function-configuration") process.exit(21);
if (process.env.MOCK_AWS_MODE === "read-failure") process.exit(17);
process.stdout.write(JSON.stringify({state:"Active",updateStatus:"Successful",v2:process.env.MOCK_AWS_MODE === "wrong-config" ? "false" : "true",semantic:"false"}));
`;
      writeFileSync(join(directory, "aws"), mock, { mode: 0o755 });
      const result = spawnSync("bash", ["-c", shell], { cwd: root, encoding: "utf8", env: {
        ...process.env, ...environment, PATH: `${directory}:${process.env.PATH}`,
        AGENT_STREAM_FUNCTION: "test-agent-stream", GITHUB_STEP_SUMMARY: summary,
        MOCK_AWS_LOG: log, MOCK_AWS_MODE: mode,
      } });
      if (mode === "success") {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(readFileSync(summary, "utf8"), verifyAgentRuntime(active, environment));
      } else {
        assert.notEqual(result.status, 0);
        assert.ok(!result.stdout.includes("Agent runtime verified"));
      }
      const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], ["lambda", "wait", "function-updated-v2", "--function-name", "test-agent-stream"]);
      assert.deepEqual(calls[1].slice(0, 4), ["lambda", "get-function-configuration", "--function-name", "test-agent-stream"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
