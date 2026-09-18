import { randomUUID } from "node:crypto";
import { build } from "esbuild";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { parseProviderRequest, parseProviderResponse, providerResponseBytes } from "../../backend/agent-api/src/adapters/fixed-egress-provider-contract.js";
import { DynamoDbConversationRepository } from "../../backend/agent-api/src/adapters/dynamodb-conversation-repository.js";
import { DynamoStateStore } from "../../backend/agent-api/src/adapters/dynamodb-state-store.js";
import { createCognitoAccessTokenVerifier } from "../../backend/agent-api/src/adapters/cognito-access-token-verifier.js";
import type { TrustedPrincipal } from "../../backend/agent-api/src/contracts/trusted-principal.js";
import { requireCheck } from "./safety.mjs";
import { viewerOrigin } from "./discovery.mjs";

export function providerRequest(now = new Date()) {
  const date = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return parseProviderRequest({ operation: "search_accommodation", requestId: `cutover-${randomUUID()}`,
    request: { destination: "京都", checkInDate: date(45), checkOutDate: date(46), adults: 1, limit: 2 } });
}
export async function providerLive(functionName: string) {
  const request = providerRequest();
  const client = new LambdaClient({ maxAttempts: 1 });
  try {
    const response = await client.send(new InvokeCommand({ FunctionName: functionName, InvocationType: "RequestResponse", LogType: "None",
      Payload: Buffer.from(JSON.stringify(request)) }), { abortSignal: AbortSignal.timeout(35_000) });
    requireCheck(response.StatusCode === 200 && !response.FunctionError && response.Payload && response.Payload.length <= providerResponseBytes);
    const result = parseProviderResponse(JSON.parse(Buffer.from(response.Payload!).toString("utf8")), request.request);
    requireCheck(result.ok);
  } finally { client.destroy(); }
}

export async function verifiedPrincipal(config: { userPoolId: string; clientId: string }, token: string) {
  // Same production verifier and owner derivation; never decode unsigned JWTs as authority.
  const principal = await createCognitoAccessTokenVerifier(config).verify(token);
  requireCheck(principal.scopes.includes("raiquora/user"));
  return principal;
}

export async function browserHarness(browser: any) {
  const bundled = await build({ stdin: { resolveDir: process.cwd(), contents:
    'import { consumeAgentStream } from "./frontend/src/adapters/http/agent-stream/consumer.ts"; window.consumeCutoverStream = consumeAgentStream;' },
    bundle: true, format: "iife", write: false, logLevel: "silent" });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await page.route(`${viewerOrigin}/`, (route: any) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Validation</title>" }));
  await page.goto(`${viewerOrigin}/`);
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  return {
    async turn(token: string, request: object) {
      return page.evaluate(async ({ token, request }: any) => {
        const events: any[] = [], measurement = { requestStart: 0, maxSilenceMs: 0 };
        let error: string | undefined;
        try {
          await (window as any).consumeCutoverStream({ token, request, endpoint: "/api/agent-stream", signal: new AbortController().signal,
            isCurrent: () => true, onEvent: (event: any) => events.push(event), measurement, idleMs: 45_000, deadlineMs: 150_000 });
        } catch (failure) { error = failure instanceof Error ? failure.message : "stream_error"; }
        return { events, measurement, error };
      }, { token, request });
    },
    async rejected(token?: string, origin = viewerOrigin) {
      // Node fetch for the direct execute-api negative check: independent of CORS.
      const response = await fetch(`${origin}/api/agent-stream`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
        headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ conversationId: randomUUID(), turnId: randomUUID(), userRequest: "cutover validation" }) });
      await response.body?.cancel();
      requireCheck([401, 403].includes(response.status));
    },
    close: () => context.close(),
  };
}

export function successfulTurn(result: any) {
  requireCheck(!result.error && result.events.some((event: any) => event.type === "progress"));
  const finals = result.events.filter((event: any) => event.type === "final");
  requireCheck(finals.length === 1 && finals[0].response.trim().length > 0);
  requireCheck(!/<\/?(?:decision_summary|tool_call|tool_result|trace|thinking)\b|"(?:toolUse|toolResult|rawResponse|access_key|application_id|requestHash|attemptId)"\s*:/iu.test(finals[0].response));
  // The shared consumer rejects unknown event/DTO fields, partial frames, missing
  // done/EOF, sequence gaps and streams over 1 MiB. Do not publish final text.
  requireCheck(Number.isFinite(result.measurement.ttfbMs) && Number.isFinite(result.measurement.completionMs));
  return finals[0].response as string;
}

export function stateReader(table: string) {
  const client = new DynamoDBClient({ maxAttempts: 1, requestHandler: { requestTimeout: 15_000 } });
  const conversations = new DynamoDbConversationRepository(table, client);
  const store = new DynamoStateStore(table, client);
  return {
    async snapshot(principal: TrustedPrincipal, conversationId: string, turnId: string, response: string) {
      const conversation = await conversations.get(principal, conversationId);
      const turn = await store.read(principal, `TURN#${conversationId}#${turnId}`);
      const payload = turn?.payload as any;
      requireCheck(conversation?.ownerSubject === principal.subject && payload?.state === "completed" && payload?.result?.response === response);
      return JSON.stringify({ conversation, turn });
    },
    async absent(principal: TrustedPrincipal, conversationId: string, turnId: string) {
      requireCheck(await conversations.get(principal, conversationId) === undefined &&
        await store.read(principal, `TURN#${conversationId}#${turnId}`) === undefined);
    },
    close: () => client.destroy(),
  };
}

// Production intentionally exports no Tool trace. Observe the dedicated Provider's
// invocation window without reading message bodies into logs. This is corroborating
// evidence, not request-level correlation in the presence of another IAM invoker.
export async function providerInvokedBetween(call: any, functionName: string, start: number, end: number) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await call("logs", "filter-log-events", { logGroupName: `/aws/lambda/${functionName}`,
      startTime: start, endTime: end, filterPattern: '"START RequestId:"', limit: 100 });
    if (result.events?.some((event: any) => /^START RequestId: [0-9a-f-]+ Version:/u.test(event.message))) return;
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  throw new Error("provider invocation evidence missing");
}
