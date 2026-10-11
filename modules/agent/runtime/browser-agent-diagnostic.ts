/** Browser observations only; never authority for Agent execution or user state. */
export const browserAgentDiagnosticCodes = ["preflight_trip_unavailable", "unauthenticated", "forbidden", "stale_generation", "aborted", "http_error", "stream_error", "invalid_endpoint", "invalid_content_type", "invalid_sequence", "missing_final", "invalid_event", "incomplete_stream", "stream_too_large", "partial_frame", "frame_too_large", "agent_failed", "limit_reached", "turn_conflict", "unknown_error"] as const;
export const browserAgentAbortReasons = ["idle_timeout", "deadline_timeout", "auth_changed", "conversation_changed", "trip_changed", "request_replaced", "disposed", "external_abort"] as const;
export interface BrowserAgentDiagnostic {
  diagnosticId: string;
  occurredAt: string;
  buildId: string;
  code: typeof browserAgentDiagnosticCodes[number];
  requestSent: boolean;
  turnId?: string;
  runId?: string;
  httpStatus?: number;
  abortReason?: typeof browserAgentAbortReasons[number];
  elapsedMs: number;
  maxSilenceMs: number;
  headersMs?: number;
  firstByteMs?: number;
}
export interface BrowserAgentDiagnosticCommand {
  version: "browser-agent-diagnostics-v1";
  operation: "record";
  reports: BrowserAgentDiagnostic[];
}
export const diagnosticUuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const uuid = new RegExp(diagnosticUuidPattern, "u");
const keys = ["diagnosticId", "occurredAt", "buildId", "code", "requestSent", "turnId", "runId", "httpStatus", "abortReason", "elapsedMs", "maxSilenceMs", "headersMs", "firstByteMs"];
export function parseBrowserAgentDiagnostic(value: unknown): BrowserAgentDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-diagnostic");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !keys.includes(key)) || typeof v.diagnosticId !== "string" || !uuid.test(v.diagnosticId) ||
      typeof v.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v.occurredAt) || !Number.isFinite(Date.parse(v.occurredAt)) || new Date(v.occurredAt).toISOString() !== v.occurredAt ||
      typeof v.buildId !== "string" || !/^(?:[0-9a-f]{7,40}|development)$/u.test(v.buildId) ||
      !(browserAgentDiagnosticCodes as readonly unknown[]).includes(v.code) || typeof v.requestSent !== "boolean" ||
      [v.turnId, v.runId].some(id => id !== undefined && (typeof id !== "string" || !uuid.test(id))) ||
      v.httpStatus !== undefined && (!Number.isInteger(v.httpStatus) || Number(v.httpStatus) < 100 || Number(v.httpStatus) > 599) ||
      v.abortReason !== undefined && !(browserAgentAbortReasons as readonly unknown[]).includes(v.abortReason) ||
      [v.elapsedMs, v.maxSilenceMs].some(ms => !duration(ms)) ||
      [v.headersMs, v.firstByteMs].some(ms => ms !== undefined && !duration(ms))) throw new Error("invalid-diagnostic");
  return { ...v } as unknown as BrowserAgentDiagnostic;
}
function duration(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 600_000; }
