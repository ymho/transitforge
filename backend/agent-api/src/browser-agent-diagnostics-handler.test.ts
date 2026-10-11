import { expect, it, vi } from "vitest";
import { createPersonalStateApiHandler } from "./personal-state-api-composition.js";
import { cognitoTokenFixture, pool, scope, token } from "./adapters/cognito-token.fixture.js";
import { createBrowserAgentDiagnosticsHandler } from "./browser-agent-diagnostics-handler.js";
import type { TrustedPrincipal } from "./contracts/trusted-principal.js";

const report = { diagnosticId: "11111111-1111-4111-8111-111111111111", occurredAt: "2026-10-11T08:00:00.000Z", buildId: "e0d06e68", code: "aborted", abortReason: "idle_timeout", requestSent: true, elapsedMs: 45000, maxSilenceMs: 45000 };
const event = (reports: unknown = [report], access?: string) => ({ path: "/api/conversations/diagnostics/v1", httpMethod: "POST", headers: access ? { authorization: `Bearer ${access}` } : {}, body: JSON.stringify({ version: "browser-agent-diagnostics-v1", operation: "record", reports }) });
it("authenticates diagnostics in the existing production host and logs only validated observations", async () => {
  const diagnosticLog = vi.fn();
  const host = createPersonalStateApiHandler({ enabled: true, auth: { userPoolId: pool, clientId: "app-client", requiredScopes: [scope] }, stateTable: "state", tripTable: "trip", verifier: cognitoTokenFixture().verifier, diagnosticLog });
  expect((await host(event())).statusCode).toBe(401);
  expect((await host(event([report], token({ scope: "openid" })))).statusCode).toBe(403);
  expect(diagnosticLog).not.toHaveBeenCalled();
  expect((await host(event([report], token()))).statusCode).toBe(200);
  expect(diagnosticLog).toHaveBeenCalledExactlyOnceWith(report);
});
it.each([
  [], Array(5).fill(report), [report, report], [{ ...report, userRequest: "PRIVATE" }], [{ ...report, code: "PRIVATE" }],
  [{ ...report, abortReason: "PRIVATE" }], [{ ...report, buildId: "PRIVATE" }], [{ ...report, elapsedMs: Infinity }],
  [{ ...report, maxSilenceMs: -1 }], [{ ...report, headersMs: 600001 }], [{ ...report, runId: "PRIVATE" }], [{ ...report, httpStatus: 999 }],
].map(reports => ({ reports })))("rejects unknown fields, content, invalid bounds and oversized/duplicate batches without logging", async ({ reports }) => {
  const log = vi.fn(), handler = createBrowserAgentDiagnosticsHandler(async () => ({} as TrustedPrincipal), log);
  expect((await handler(event(reports))).statusCode).toBe(400);
  expect(log).not.toHaveBeenCalled();
});
it("rejects wrong method/path/query/encoded/oversized payloads and a wrong version", async () => {
  const log = vi.fn(), handler = createBrowserAgentDiagnosticsHandler(async () => ({} as TrustedPrincipal), log);
  for (const request of [{ ...event(), httpMethod: "GET" }, { ...event(), rawPath: "/wrong" }, { ...event(), rawQueryString: "private=1" }, { ...event(), isBase64Encoded: true }, { ...event(), body: "x".repeat(4097) }, { ...event(), body: event().body.replace("browser-agent-diagnostics-v1", "wrong") }]) expect((await handler(request)).statusCode).toBe(400);
  expect(log).not.toHaveBeenCalled();
});
it("does not fail a request when the logging sink throws", async () => {
  const handler = createBrowserAgentDiagnosticsHandler(async () => ({} as TrustedPrincipal), () => { throw new Error("sink unavailable"); });
  expect((await handler(event())).statusCode).toBe(200);
});
