import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { aws, gates, Report, requireCheck } from "./safety.mjs";
import { contract, migrate, readSecret, secretNames } from "./secrets.mjs";
import { discover } from "./discovery.mjs";
import { cleanupUsers, createUsers, ledgerPath, login } from "./cognito.mjs";
import { browserHarness, providerInvokedBetween, providerLive, providerRequest, stateReader, successfulTurn, verifiedPrincipal, waitForGatewayThrottleRecovery } from "./live.js";

async function main() {
  process.umask(0o077);
  const report = new Report();
  const mode = process.env.CUTOVER_MODE;
  let config: any, browser: any, harness: any, state: ReturnType<typeof stateReader> | undefined;
  let failed = false;
  try {
    await report.check("environment gates", () => { gates(process.env); requireCheck(["verify", "migrate-secrets", "e2e", "all", "cleanup"].includes(mode ?? "")); });
    if (mode === "cleanup") {
      // Cleanup must not depend on unrelated Provider/Secret/Gateway checks succeeding.
      await report.check("temporary user cleanup", async () => {
        const agent = await aws("lambda", "get-function-configuration", { FunctionName: "transitforge-dev-agent-stream" }) as any;
        config = { userPoolId: agent.Environment?.Variables?.COGNITO_USER_POOL_ID };
        requireCheck(/^ap-northeast-1_[A-Za-z0-9]+$/u.test(config.userPoolId));
        await cleanupUsers(aws, config, ledgerPath());
      });
      return;
    }
    config = await report.check("AWS ingress and configuration", () => discover(aws, (label, action) => report.check(label, action)));
    if (mode === "all" || mode === "migrate-secrets") await report.check("secret migration", () => migrate(aws));
    await report.check("fixed-egress secret contract", async () => contract(await readSecret(aws, secretNames.travel), "travel"));
    await report.check("agent provider secret contract", async () => contract(await readSecret(aws, secretNames.agent), "agent"));
    if (mode !== "all" && mode !== "e2e") return;
    await report.check("provider live test", () => providerLive(config.providerName));
    const users = await report.check("temporary user setup", () => createUsers(aws, config, ledgerPath()));
    const modulePath = process.env.PLAYWRIGHT_MODULE;
    requireCheck(modulePath);
    const { chromium } = await import(pathToFileURL(modulePath!).href);
    browser = await chromium.launch({ headless: true });
    harness = await browserHarness(browser);
    const authenticate = async (index: number) => {
      const token = await login(browser, config, users[index]);
      const principal = await verifiedPrincipal(config, token);
      return { token, principal };
    };
    let a = await report.check("PKCE User A", () => authenticate(0));
    let b = await report.check("PKCE User B", () => authenticate(1));
    requireCheck(a.principal.subject !== b.principal.subject);
    await report.check("unauthenticated rejection", async () => { await harness.rejected(); await harness.rejected(undefined, config.directOrigin); });
    await report.check("invalid token rejection", async () => { await harness.rejected("invalid.token.value"); await harness.rejected("invalid.token.value", config.directOrigin); });
    await waitForGatewayThrottleRecovery();
    state = stateReader(config.stateTable);
    const request = { conversationId: randomUUID(), turnId: randomUUID(), userRequest: "E2E cutover validation: こんにちは。短く挨拶だけ返してください。" };
    const response = await report.check("simple real Bedrock turn", async () => successfulTurn(await harness.turn(a.token, request)));
    const snapshot = await report.check("persisted turn", () => state!.snapshot(a.principal, request.conversationId, request.turnId, response));
    await report.check("replay/idempotency", async () => {
      requireCheck(successfulTurn(await harness.turn(a.token, request)) === response);
      requireCheck(await state!.snapshot(a.principal, request.conversationId, request.turnId, response) === snapshot);
    });
    await report.check("conflict rejection", async () => {
      const result = await harness.turn(a.token, { ...request, userRequest: "E2E cutover validation: 異なる入力" });
      requireCheck(result.error === "turn_conflict" && !result.events.some((event: any) => event.type === "final"));
      requireCheck(await state!.snapshot(a.principal, request.conversationId, request.turnId, response) === snapshot);
    });
    // Preserve other useful checks even if the known owner-namespace gate fails.
    try {
      await report.check("owner isolation", async () => {
        b = await authenticate(1);
        // An expired token or a generally forbidden User B must not fake an owner rejection.
        successfulTurn(await harness.turn(b.token, { conversationId: randomUUID(), turnId: randomUUID(),
          userRequest: "E2E cutover validation: 短く挨拶してください。" }));
        const result = await harness.turn(b.token, { ...request, userRequest: "E2E cutover validation: この会話の直前の回答を表示してください。" });
        requireCheck(["http_403", "http_404"].includes(result.error) && !result.events.some((event: any) => event.type === "final"));
        await state!.absent(b.principal, request.conversationId, request.turnId);
        requireCheck(await state!.snapshot(a.principal, request.conversationId, request.turnId, response) === snapshot);
      });
    } catch { failed = true; }
    // Five-minute Access Tokens: fresh PKCE login before the separate bounded turn.
    a = await authenticate(0);
    const dates = providerRequest().request;
    await report.check("accommodation Tool turn", async () => {
      const start = Date.now();
      const accommodationRequest = { conversationId: randomUUID(), turnId: randomUUID(),
        userRequest: `E2E cutover validation: 京都の宿泊施設を${dates.checkInDate}チェックイン、${dates.checkOutDate}チェックアウト、大人1人で2件検索してください。search_accommodationsを実行して実際の検索結果だけを案内してください。` };
      const final = successfulTurn(await harness.turn(a.token, accommodationRequest));
      const end = Date.now();
      await state!.snapshot(a.principal, accommodationRequest.conversationId, accommodationRequest.turnId, final);
      await providerInvokedBetween(aws, config.providerName, start, end);
    });
  } catch { failed = true; }
  finally {
    try { await harness?.close(); await browser?.close(); } catch { failed = true; }
    state?.close();
    if (config && mode !== "cleanup" && ["all", "e2e"].includes(mode ?? "")) {
      try { await report.check("temporary user cleanup", () => cleanupUsers(aws, config, ledgerPath())); }
      catch { failed = true; }
    }
    try { await report.check("SERVER_AGENT_ENABLED remains false", () => gates(process.env)); } catch { failed = true; }
    if (mode !== "cleanup") {
      try { await report.check("cutover validation", () => requireCheck(!failed)); } catch { failed = true; }
    }
    report.publish(mode === "cleanup");
    if (failed) process.exitCode = 1;
  }
}
// Never let SDK, browser, parser or filesystem errors escape with sensitive context.
void main().catch(() => { process.stdout.write("cutover validation: FAIL\n"); process.exitCode = 1; });
