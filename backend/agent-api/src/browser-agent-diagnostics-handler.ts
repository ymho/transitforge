import { randomUUID } from "node:crypto";
import { parseBrowserAgentDiagnostic, type BrowserAgentDiagnostic } from "@raiquora/agent/browser-agent-diagnostic";
import { authenticationErrorResponse, httpMethod } from "./adapters/http-api-auth.js";
import { requirePersonalOperation } from "./adapters/api-route-policy.js";
import { jsonResponse, type LambdaHttpEvent, type LambdaContext } from "./contracts/http.js";
import { exactObject } from "./contracts/server-state.js";
import type { TrustedPrincipal } from "./contracts/trusted-principal.js";

/** Validated, untrusted Browser observations. No reads, model calls or business writes. */
export function createBrowserAgentDiagnosticsHandler(authenticate: (event: LambdaHttpEvent) => Promise<TrustedPrincipal>,
  log: (report: BrowserAgentDiagnostic) => void) {
  return async (event: LambdaHttpEvent, context?: LambdaContext) => {
    const version = "browser-agent-diagnostics-v1", requestId = context?.awsRequestId ?? randomUUID();
    try {
      await authenticate(event);
      if (httpMethod(event) !== "POST" || event.isBase64Encoded || typeof event.body !== "string" || Buffer.byteLength(event.body, "utf8") > 4096) throw new Error("invalid-input");
      const command: unknown = JSON.parse(event.body);
      requirePersonalOperation("browserDiagnostics", event, command);
      exactObject(command, ["version", "operation", "reports"]);
      const reports = (command as { reports?: unknown }).reports;
      if (!Array.isArray(reports) || reports.length < 1 || reports.length > 4) throw new Error("invalid-input");
      const parsed = reports.map(parseBrowserAgentDiagnostic);
      if (new Set(parsed.map(value => value.diagnosticId)).size !== parsed.length) throw new Error("invalid-input");
      for (const report of parsed) { try { log(report); } catch { /* Diagnostics cannot fail a user operation. */ } }
      return jsonResponse(200, { version, ok: true }, requestId);
    } catch (error) {
      return authenticationErrorResponse(error, version, requestId) ?? jsonResponse(400, { version, error: "invalid-input" }, requestId);
    }
  };
}
