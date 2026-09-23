import type { AgentTurnEventSink } from "@raiquora/agent/agent-progress";
import type { ServerAgentTurn } from "./usecases/agent/server-agent.js";
import type { ConversationTurnInput } from "./usecases/agent/conversation-turn.js";
import { stateId } from "./contracts/server-state.js";
import type { AccessTokenVerifier } from "./ports/access-token-verifier.js";
import { authenticatedApplication } from "./usecases/authenticated-application.js";
import { AuthenticationError } from "./contracts/trusted-principal.js";

import type { StreamRequest, StreamWriter } from "./ports/agent-stream-transport.js";
export type { StreamRequest, StreamWriter } from "./ports/agent-stream-transport.js";
export type ObservedAgentRun = (input: ServerAgentTurn, emit: AgentTurnEventSink, runId: string) => Promise<void>;

/** Shared POST transport boundary. Authorizer claims/body identity never establish the principal. */
export function createAgentStreamHandler(options: { verifier: AccessTokenVerifier; run: ObservedAgentRun; newRunId: () => string; heartbeatMs?: number; path: string; enabled?: boolean; conversationTurns?: boolean; log?: (fields: StreamLog) => void }) {
  const authenticate = authenticatedApplication(options.verifier, ["raiquora/user"], async principal => principal);
  return async (request: StreamRequest, writer: StreamWriter): Promise<void> => {
    const began = Date.now();
    const requestId = options.newRunId();
    const log = (event: StreamLog["event"], status?: number) => options.log?.({ event, requestId,
      apiRequestId: safeId(request.apiRequestId), lambdaRequestId: safeId(request.lambdaRequestId),
      ...(runId ? { executionId: runId } : {}), latencyMs: Date.now() - began, ...(status ? { status } : {}) });
    let outcome: StreamLog["event"] = "error";
    let started = false, sequence = 0, terminal = false, runId = "";
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let queue = Promise.resolve();
    let writeFailed = false, streamLogged = false;
    const send = (frame: string) => {
      queue = queue.then(async () => {
        if (writer.signal.aborted || writeFailed) throw new Error("disconnected");
        await writer.write(frame);
        if (!streamLogged) { streamLogged = true; log("stream_started"); }
      });
      // Observe timer failures immediately; never continue writing after a failed write.
      void queue.catch(() => { writeFailed = true; });
      return queue;
    };
    const emit: AgentTurnEventSink = async event => {
      if (terminal) throw new Error("event after terminal");
      if (event.type !== "progress") terminal = true;
      await send(`event: agent\ndata: ${JSON.stringify({ v: 1, runId, seq: ++sequence, event })}\n\n`);
      if (event.type === "final") { log("final_sent"); outcome = "completed"; }
      if (event.type === "error") outcome = "error";
    };
    try {
      log("request_started");
      if (options.enabled === false) throw new InputError(503);
      if (request.method !== "POST" || request.path !== options.path) throw new InputError(404);
      if (request.query && Object.keys(request.query).length) throw new InputError(400);
      const authorization = header(request, "authorization");
      if (!authorization || !/^Bearer [A-Za-z0-9._~-]+$/u.test(authorization)) throw new AuthenticationError("unauthenticated");
      const principal = await authenticate(authorization.slice(7), undefined);
      if (writer.signal.aborted) return;
      if (header(request, "content-type")?.split(";")[0].trim() !== "application/json") throw new InputError(415);
      const input = parseInput(request, options.conversationTurns);
      runId = requestId;
      writer.start(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", "x-content-type-options": "nosniff" });
      started = true;
      // Heartbeats keep the transport alive but are never useful content or model tokens.
      heartbeat = setInterval(() => { if (!writeFailed && !writer.signal.aborted) void send(": heartbeat\n\n").catch(() => {}); }, options.heartbeatMs ?? 10_000);
      await options.run({ ...input, principal }, emit, runId);
      clearInterval(heartbeat);
      if (!terminal) await emit({ type: "error", code: "agent_failed" });
      await send(`event: done\ndata: ${JSON.stringify({ v: 1, runId, seq: ++sequence })}\n\n`);
    } catch (error) {
      outcome = "error";
      if (writer.signal.aborted || writeFailed) return;
      if (!started) {
        const status = error instanceof AuthenticationError ? error.code === "forbidden" ? 403 : 401 : error instanceof InputError ? error.status : 500;
        log("rejected", status);
        writer.start(status, { "content-type": "application/json", "cache-control": "no-store", ...(status === 401 ? { "www-authenticate": "Bearer" } : {}) });
        await writer.write(JSON.stringify({ error: status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : "request_failed" }));
      } else if (!terminal) {
        await emit({ type: "error", code: "agent_failed" });
        await send(`event: done\ndata: ${JSON.stringify({ v: 1, runId, seq: ++sequence })}\n\n`);
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await queue.catch(() => {});
      try { await writer.end(); } catch { outcome = "disconnected"; }
      log(writer.signal.aborted || writeFailed ? "disconnected" : outcome);
    }
  };
}
class InputError extends Error { constructor(readonly status: number) { super("invalid request"); } }
function header(request: StreamRequest, name: string): string | undefined {
  const headers = Object.entries(request.headers ?? {}).filter(([key]) => key.toLowerCase() === name);
  const multi = Object.entries(request.multiValueHeaders ?? {}).filter(([key]) => key.toLowerCase() === name);
  if (headers.length > 1 || multi.length > 1 || multi.some(([, values]) => values?.length !== 1)) throw new InputError(400);
  const value = headers[0]?.[1], multiValue = multi[0]?.[1]?.[0];
  if (multiValue !== undefined && value !== undefined && multiValue !== value) throw new InputError(400);
  return multiValue ?? value;
}
function parseInput(request: StreamRequest, conversationTurns = false): Omit<ConversationTurnInput, "principal"> {
  if (request.isBase64Encoded || typeof request.body !== "string" || new TextEncoder().encode(request.body).length > 40_000) throw new InputError(400);
  let value: unknown;
  try { value = JSON.parse(request.body); } catch { throw new InputError(400); }
  if (!record(value) || Object.keys(value).some(k => !["userRequest", "requestedResearchMode", "researchTarget", "conversationId", "tripId", "uiContext", ...(conversationTurns ? ["turnId"] : [])].includes(k)) ||
      typeof value.userRequest !== "string" || !value.userRequest.trim() || value.userRequest.length > 8_000) throw new InputError(400);
  if (value.requestedResearchMode !== undefined && !["standard", "detailed"].includes(String(value.requestedResearchMode))) throw new InputError(400);
  if (value.researchTarget !== undefined && !validResearchTarget(value.researchTarget)) throw new InputError(400);
  if (value.uiContext !== undefined && (!record(value.uiContext) || Object.keys(value.uiContext).some(k => !["itemId", "calendarDate"].includes(k)))) throw new InputError(400);
  for (const ref of [value.conversationId, value.tripId, record(value.uiContext) ? value.uiContext.itemId : undefined]) {
    if (ref !== undefined && (typeof ref !== "string" || !ref.trim() || ref.length > 200 || /[\u0000-\u001f\u007f]/u.test(ref))) throw new InputError(400);
  }
  const calendarDate = record(value.uiContext) ? value.uiContext.calendarDate : undefined;
  if (calendarDate !== undefined && (typeof calendarDate !== "string" || !validCalendarDate(calendarDate))) throw new InputError(400);
  if (conversationTurns) {
    try { stateId(value.conversationId); stateId(value.turnId); if (value.tripId !== undefined) stateId(value.tripId); }
    catch { throw new InputError(400); }
  }
  return value as unknown as Omit<ConversationTurnInput, "principal">;
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validResearchTarget(value: unknown): boolean {
  if (!record(value) || Object.keys(value).some((key) => !["presentationId", "candidateSetId", "candidateSetRevision", "tripId", "baseTripRevision"].includes(key)) ||
      typeof value.presentationId !== "string" || !value.presentationId.trim() || value.presentationId.length > 200 || /[\u0000-\u001f\u007f]/u.test(value.presentationId) ||
      value.candidateSetId !== undefined && (typeof value.candidateSetId !== "string" || !value.candidateSetId.trim() || value.candidateSetId.length > 300) ||
      value.tripId !== undefined && (typeof value.tripId !== "string" || !value.tripId.trim() || value.tripId.length > 200) ||
      [value.candidateSetRevision, value.baseTripRevision].some((item) => item !== undefined && (!Number.isSafeInteger(item) || Number(item) < 0)) ||
      (value.candidateSetId === undefined) !== (value.candidateSetRevision === undefined)) return false;
  return true;
}
function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export interface StreamLog {
  event: "request_started" | "stream_started" | "final_sent" | "completed" | "error" | "rejected" | "disconnected";
  requestId: string;
  apiRequestId?: string;
  lambdaRequestId?: string;
  executionId?: string;
  latencyMs: number;
  status?: number;
}
function safeId(value: string | undefined): string | undefined {
  return value && /^[A-Za-z0-9_+=/-]{1,128}$/u.test(value) ? value : undefined;
}
