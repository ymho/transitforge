import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aws, gates, Report } from "./safety.mjs";

const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
  SERVER_AGENT_ENABLED: "false", AGENT_STREAM_ENABLED: "true", FIXED_EGRESS_PROVIDER_ENABLED: "true" };
test("missing, stale and enabled browser gates fail closed", () => {
  assert.doesNotThrow(() => gates(env));
  for (const patch of [{ SERVER_AGENT_ENABLED: "true" }, { SERVER_AGENT_ENABLED: "" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "push" }, { GITHUB_ACTIONS: "false" }, { AGENT_STREAM_ENABLED: "false" }, { DEBUG: "pw:*" }]) assert.throws(() => gates({ ...env, ...patch }));
});
test("all failure classes produce only fixed labels without nested exception/secret/token content", async () => {
  const report = new Report();
  for (const [label, error] of [["secret migration", new Error("SYNTHETIC_SECRET")], ["PKCE User A", new Error("SYNTHETIC_TOKEN")],
    ["accommodation Tool turn", { body: "SYNTHETIC_PROVIDER", claims: "SYNTHETIC_USERNAME" }]]) {
    await assert.rejects(report.check(label, async () => { throw error; }), /^Error: validation failed$/u);
  }
  assert.doesNotMatch(report.render(), /SYNTHETIC/u);
  await assert.rejects(report.check("SYNTHETIC_ARBITRARY_LABEL", async () => {}));
  assert.match(report.render(), /secret migration: FAIL/u);
  assert.match(report.render(), /180s transport: NOT RUN/u);
});
test("CLI credentials use stdin and raw stderr is never forwarded or retained on errors", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cutover-cli-test-"));
  const previous = process.env.PATH;
  try {
    writeFileSync(join(dir, "aws"), '#!/bin/sh\ncat >/dev/null\necho "SYNTHETIC_SECRET stdout"\necho "SYNTHETIC_TOKEN stderr" >&2\nexit 1\n', { mode: 0o700 });
    process.env.PATH = `${dir}:${previous}`;
    await assert.rejects(aws("synthetic", "operation", { Password: "SYNTHETIC_PASSWORD" }), /^Error: AWS operation failed$/u);
    writeFileSync(join(dir, "aws"), '#!/bin/sh\ncat >/dev/null\necho "An error occurred (AccessDeniedException) PRIVATE" >&2\nexit 1\n', { mode: 0o700 });
    await assert.rejects(aws("synthetic", "operation", {}, { missing: true }), /^Error: AWS operation failed$/u);
    writeFileSync(join(dir, "aws"), '#!/bin/sh\ncat >/dev/null\necho "An error occurred (ResourceNotFoundException) PRIVATE" >&2\nexit 1\n', { mode: 0o700 });
    assert.equal(await aws("synthetic", "operation", {}, { missing: true }), undefined);
  } finally { process.env.PATH = previous; rmSync(dir, { recursive: true, force: true }); }
});
test("STS GetCallerIdentity reproduces the no-input CLI failure and uses the safe no-input form", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cutover-sts-test-"));
  const previous = process.env.PATH;
  try {
    writeFileSync(join(dir, "aws"), '#!/bin/sh\nfor arg in "$@"; do [ "$arg" = "--cli-input-json" ] && { echo "synthetic cli input failure" >&2; exit 2; }; done\nprintf "%s" \'{"Account":"123456789012"}\'\n', { mode: 0o700 });
    process.env.PATH = `${dir}:${previous}`;
    await assert.rejects(aws("sts", "get-caller-identity", { synthetic: "input" }), /^Error: AWS operation failed$/u);
    assert.deepEqual(await aws("sts", "get-caller-identity"), { Account: "123456789012" });
  } finally { process.env.PATH = previous; rmSync(dir, { recursive: true, force: true }); }
});
test("workflow is manual-only, serializes with CD and limits session mutation permissions", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/server-agent-cutover-validation.yml", import.meta.url), "utf8");
  assert.match(workflow, /on:\s+workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\n  (push|workflow_run|schedule|pull_request):|terraform |upload-artifact|set -x|s3 sync/u);
  assert.match(workflow, /group: transitforge-dev\s+cancel-in-progress: false/u);
  assert.match(workflow, /environment: dev/u);
  assert.match(workflow, /default: verify/u);
  assert.match(workflow, /if: always\(\).*steps.credentials.outcome/u);
  const raw = workflow.split("inline-session-policy: >-\n")[1].split("\n      - name:")[0];
  const policy = JSON.parse(raw);
  assert.ok(JSON.stringify(policy).length <= 2048, "STS inline session policy plaintext limit");
  const actions = policy.Statement.flatMap(entry => [].concat(entry.Action));
  assert.ok(actions.includes("secretsmanager:PutSecretValue"));
  assert.ok(actions.includes("cognito-idp:AdminDeleteUser"));
  assert.ok(actions.every(action => !/Update|DeleteSecret|PutItem|PutObject|CreateInvalidation/u.test(action)));
  const put = policy.Statement.find(entry => entry.Action === "secretsmanager:PutSecretValue");
  assert.equal(put.Resource.length, 2);
  assert.ok(!put.Resource.includes("arn:aws:secretsmanager:ap-northeast-1:*:secret:/transitforge/dev/travel-provider-*"));
});
