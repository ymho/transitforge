import { browserAgentDiagnosticCodes, diagnosticUuidPattern, parseBrowserAgentDiagnostic, type BrowserAgentDiagnostic } from "@raiquora/agent/browser-agent-diagnostic";
import type { AuthSession } from "../../../usecases/auth/auth-session";
import type { StreamMeasurement } from "./consumer";

/** Best effort, memory-only bounded outbox. Tokens are never serialized with reports.
 * No token refresh/invalidation, timer retries, UI changes or automatic Agent retry. */
export function createBrowserAgentDiagnostics(options: { auth: AuthSession; buildId: string; fetcher?: typeof fetch; now?: () => number; newId?: () => string }) {
  const now = options.now ?? Date.now;
  let generation = 0, token: string | undefined, sending = false;
  let active: AbortController | undefined;
  let queue: { report: BrowserAgentDiagnostic; attempts: number; queuedAt: number }[] = [];
  const unsubscribe = options.auth.subscribe(() => { generation++; token = undefined; queue = []; active?.abort(); });
  const prune = () => { queue = queue.filter(item => now() - item.queuedAt < 1_800_000 && item.attempts < 2).slice(-8); };
  const flush = async () => {
    prune();
    if (sending || !token || !queue.length || options.auth.getState().status !== "signed-in") return;
    const epoch = generation, batch = queue.slice(0, 4), accessToken = token;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 5000);
    active = controller;
    sending = true;
    batch.forEach(item => item.attempts++);
    try {
      const response = await (options.fetcher ?? fetch)("/api/conversations/diagnostics/v1", { method: "POST", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ version: "browser-agent-diagnostics-v1", operation: "record", reports: batch.map(item => item.report) }), signal: controller.signal });
      if (epoch !== generation) return;
      if (response.ok || response.status >= 400 && response.status < 500 && response.status !== 429) queue = queue.filter(item => !batch.includes(item));
      await response.body?.cancel().catch(() => {});
    } catch { /* Retain for one later online/new-consultation opportunity; no immediate retry. */ }
    finally { clearTimeout(timeout); if (active === controller) active = undefined; sending = false; prune(); }
  };
  return {
    // The caller supplies a token already acquired for a business request. Diagnostics never acquire one.
    authorize(accessToken: string) { token = accessToken; void flush(); },
    contextVersion: () => generation,
    record(error: unknown, measurement: StreamMeasurement, turnId?: string, epoch = generation) {
      if (epoch !== generation || options.auth.getState().status !== "signed-in") return;
      try {
        const message = error instanceof Error ? error.message : "unknown_error";
        const code = /^http_\d{3}$/u.test(message) ? "http_error" : (browserAgentDiagnosticCodes as readonly string[]).includes(message) ? message : "unknown_error";
        const report = parseBrowserAgentDiagnostic({ diagnosticId: (options.newId ?? (() => crypto.randomUUID()))(), occurredAt: new Date(now()).toISOString(), buildId: options.buildId,
          code, requestSent: measurement.requestSent ?? false, elapsedMs: duration(measurement.settledMs ?? 0), maxSilenceMs: duration(measurement.maxSilenceMs),
          ...(turnId && new RegExp(diagnosticUuidPattern, "u").test(turnId) ? { turnId } : {}),
          ...(measurement.runId && new RegExp(diagnosticUuidPattern, "u").test(measurement.runId) ? { runId: measurement.runId } : {}),
          ...(measurement.httpStatus === undefined ? {} : { httpStatus: measurement.httpStatus }),
          ...(measurement.abortReason === undefined ? {} : { abortReason: measurement.abortReason }),
          ...(measurement.headersMs === undefined ? {} : { headersMs: duration(measurement.headersMs) }),
          ...(measurement.ttfbMs === undefined ? {} : { firstByteMs: duration(measurement.ttfbMs) }) });
        prune(); queue.push({ report, attempts: 0, queuedAt: now() }); queue = queue.slice(-8); void flush();
      } catch { /* Unknown messages/metadata never become diagnostic payloads. */ }
    },
    flush: () => { void flush(); },
    dispose() { unsubscribe(); generation++; token = undefined; queue = []; active?.abort(); },
  };
}
function duration(ms: number) { return Math.max(0, Math.min(600_000, Math.round(ms))); }
export type BrowserAgentDiagnostics = ReturnType<typeof createBrowserAgentDiagnostics>;
