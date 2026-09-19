import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function requireCheck(condition) {
  if (!condition) throw new Error("validation failed");
}

// No exception, remote response, identifier, or caller-provided label reaches a log.
export const labels = [
  "environment gates", "AWS ingress and configuration", "secret migration",
  "AWS discovery / identity", "AWS discovery / Lambda topology", "AWS discovery / secret wiring",
  "AWS discovery / public ingress absence", "AWS discovery / API Gateway route",
  "AWS discovery / API Gateway streaming", "AWS discovery / CloudFront route",
  "AWS discovery / Lambda permission", "AWS discovery / IAM Provider invoke",
  "AWS discovery / Cognito OAuth",
  "fixed-egress secret contract", "agent provider secret contract", "provider live test",
  "temporary user setup", "PKCE User A", "PKCE User B", "unauthenticated rejection", "invalid token rejection",
  "simple real Bedrock turn", "accommodation Tool turn", "persisted turn",
  "replay/idempotency", "conflict rejection", "owner isolation", "temporary user cleanup",
  "35s transport", "90s transport", "180s transport", "Trip isolation",
  "SERVER_AGENT_ENABLED remains false", "cutover validation",
];
export class Report {
  results = new Map(labels.map(label => [label, "NOT RUN"]));
  async check(label, action) {
    requireCheck(this.results.has(label));
    try { const result = await action(); this.results.set(label, "PASS"); return result; }
    catch { this.results.set(label, "FAIL"); throw new Error("validation failed"); }
  }
  render(onlyRun = false) { return [...this.results].filter(([, result]) => !onlyRun || result !== "NOT RUN").map(([label, result]) => `- ${label}: ${result}`).join("\n") + "\n"; }
  publish(onlyRun = false) {
    const summary = this.render(onlyRun);
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

// CLI input stays in a private directory (0700) and request file (0600), never argv.
// AWS CLI retry is disabled: an ambiguous mutation is resolved by verification/cleanup.
export async function aws(service, operation, input, { missing = false } = {}) {
  let directory;
  try {
    // Undefined means no request input; an explicit empty object still uses JSON.
    const args = [service, operation];
    if (input !== undefined) {
      directory = mkdtempSync(join(tmpdir(), "cutover-aws-"));
      const path = join(directory, "input.json");
      writeFileSync(path, JSON.stringify(input), { mode: 0o600, flag: "wx" });
      args.push("--cli-input-json", `file://${path}`);
    }
    args.push("--output", "json", "--no-cli-pager");
    return await new Promise((resolve, reject) => {
      const child = spawn("aws", args, {
        stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, AWS_MAX_ATTEMPTS: "1", AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" },
      });
      let output = "", diagnostic = "", settled = false;
      const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error("AWS operation failed")); } };
      const timer = setTimeout(() => { child.kill("SIGKILL"); fail(); }, 45_000);
      child.on("error", fail);
      child.stdout.on("data", data => { output += data; if (output.length > 4_194_304) { child.kill("SIGKILL"); fail(); } });
      child.stderr.on("data", data => { diagnostic += data; if (diagnostic.length > 65_536) { child.kill("SIGKILL"); fail(); } });
      child.on("close", code => {
        clearTimeout(timer);
        if (settled) return;
        if (code !== 0) {
          if (missing && /\((ResourceNotFoundException|UserNotFoundException)\)/u.test(diagnostic)) { settled = true; resolve(undefined); }
          else fail();
          return;
        }
        try { const value = output.trim() ? JSON.parse(output) : {}; settled = true; resolve(value); }
        catch { fail(); }
      });
    });
  } catch {
    throw new Error("AWS operation failed");
  } finally {
    if (directory) {
      try { rmSync(directory, { recursive: true, force: true }); }
      catch { throw new Error("AWS operation failed"); }
    }
  }
}

export function gates(env) {
  requireCheck(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "workflow_dispatch" && env.GITHUB_REF === "refs/heads/main");
  requireCheck(env.SERVER_AGENT_ENABLED === "false" && env.AGENT_STREAM_ENABLED === "true" && env.FIXED_EGRESS_PROVIDER_ENABLED === "true");
  requireCheck(!env.ACTIONS_STEP_DEBUG && !env.DEBUG && !env.PWDEBUG && !env.NODE_DEBUG);
}
