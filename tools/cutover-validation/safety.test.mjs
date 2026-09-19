import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
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
test("sub-check classification renders fixed status without remote values", () => {
  const report = new Report();
  report.record("simple turn / internal markup absent", false);
  const summary = report.render();
  assert.match(summary, /simple turn \/ internal markup absent: FAIL/u);
  assert.doesNotMatch(summary, /SYNTHETIC_PRIVATE_RESPONSE/u);
  assert.throws(() => report.record("SYNTHETIC_PRIVATE_RESPONSE", false));
});
test("CLI errors never expose raw stdout or stderr", async () => {
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
test("private CLI input is removed on success and every failure path", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "cutover-cli-test-"));
  const previousPath = process.env.PATH;
  const previousTmp = process.env.TMPDIR;
  const receipt = join(dir, "receipt.json");
  const source = `#!${process.execPath}
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
const args = process.argv.slice(2);
const [service, operation] = args;
if (service === "sts") {
  if (args.length !== 5 || args.slice(2).join(" ") !== "--output json --no-cli-pager") process.exit(2);
  console.log('{}');
} else {
  const path = args[3]?.slice("file://".length);
  const input = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({
    args, input, path, fileMode: statSync(path).mode & 0o777, directoryMode: statSync(dirname(path)).mode & 0o777,
  }));
  if (operation === "error") { console.error("SYNTHETIC_SECRET"); process.exit(2); }
  if (operation === "missing") { console.error("(ResourceNotFoundException) SYNTHETIC_SECRET"); process.exit(2); }
  if (operation === "invalid") console.log("SYNTHETIC_SECRET");
  else if (operation === "oversized") process.stdout.write("X".repeat(4_194_305));
  else if (operation === "diagnostic") process.stderr.write("X".repeat(65_537));
  else if (operation === "timeout") setInterval(() => {}, 1000);
  else console.log('{}');
}
`;
  try {
    process.env.TMPDIR = dir;
    process.env.PATH = `${dir}:${previousPath}`;
    writeFileSync(join(dir, "aws"), source, { mode: 0o700 });
    const clean = () => assert.deepEqual(readdirSync(dir).filter(name => name.startsWith("cutover-aws-")), []);
    assert.deepEqual(await aws("sts", "get-caller-identity"), {});
    assert.equal(existsSync(receipt), false);
    clean();
    for (const input of [{ Password: "SYNTHETIC_PASSWORD" }, {}]) {
      assert.deepEqual(await aws("synthetic", "success", input), {});
      const record = JSON.parse(readFileSync(receipt, "utf8"));
      assert.deepEqual(record.input, input);
      assert.deepEqual(record.args, ["synthetic", "success", "--cli-input-json", `file://${record.path}`, "--output", "json", "--no-cli-pager"]);
      assert.equal(record.fileMode, 0o600);
      assert.equal(record.directoryMode, 0o700);
      assert.doesNotMatch(JSON.stringify(record.args), /SYNTHETIC_PASSWORD|dev\/stdin/u);
      assert.equal(existsSync(record.path), false);
      clean();
    }
    for (const operation of ["error", "invalid", "oversized", "diagnostic"]) {
      await assert.rejects(aws("synthetic", operation, {}), /^Error: AWS operation failed$/u, operation);
      clean();
    }
    assert.equal(await aws("synthetic", "missing", {}, { missing: true }), undefined);
    clean();
    // Advance only the wrapper deadline; the synthetic child remains a real process.
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const timeout = assert.rejects(aws("synthetic", "timeout", {}), /^Error: AWS operation failed$/u);
    t.mock.timers.tick(45_000);
    await timeout;
    t.mock.timers.reset();
    clean();
    rmSync(join(dir, "aws"));
    process.env.PATH = dir;
    await assert.rejects(aws("synthetic", "spawn-failure", {}), /^Error: AWS operation failed$/u);
    clean();
    const cyclic = {}; cyclic.self = cyclic;
    await assert.rejects(aws("synthetic", "serialization-failure", cyclic), /^Error: AWS operation failed$/u);
    clean();
    process.env.TMPDIR = join(dir, "absent");
    await assert.rejects(aws("synthetic", "filesystem-failure", {}), /^Error: AWS operation failed$/u);
  } finally {
    t.mock.timers.reset();
    process.env.PATH = previousPath;
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
    rmSync(dir, { recursive: true, force: true });
  }
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
