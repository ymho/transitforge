import { parsePublicCostProposal } from "@raiquora/trip/public-cost-proposal";
import { parseConsultationRequestProposal } from "@raiquora/trip/consultation-request-proposal";
import { parsePublicRequestProposal } from "@raiquora/trip/public-request-proposal";
import { agentProgressPhases, type AgentTurnEvent } from "@raiquora/agent/agent-progress";
import { parsePublicPlanPresentation } from "@raiquora/agent/public-plan-presentation";
import { parseResearchExecutionOutcome } from "@raiquora/agent/research-execution";
import { parsePublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";

export interface StreamMeasurement {
  requestStart: number;
  headersMs?: number;
  ttfbMs?: number;
  ttfiMs?: number;
  completionMs?: number;
  settledMs?: number;
  maxSilenceMs: number;
  error?: string;
}
export class AgentStreamError extends Error {}

/** POST/fetch, one run only. No automatic reconnect/retry and no token in the URL. */
export async function consumeAgentStream(options: {
  token: string; request: { userRequest: string; requestedResearchMode?: "standard" | "detailed"; researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number }; conversationId?: string; turnId?: string; tripId?: string; uiContext?: { itemId?: string; calendarDate?: string } };
  signal: AbortSignal; isCurrent: () => boolean; onEvent: (event: AgentTurnEvent) => void;
  measurement: StreamMeasurement; endpoint?: string; fetcher?: typeof fetch; now?: () => number;
  idleMs?: number; deadlineMs?: number;
}): Promise<void> {
  const now = options.now ?? (() => performance.now()), metrics = options.measurement;
  const endpoint = options.endpoint ?? "/api/agent-stream-poc";
  if (!/^\/(?!\/)[^?#]*$/u.test(endpoint)) throw new AgentStreamError("invalid_endpoint");
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  let idle: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(abort, options.deadlineMs ?? 270_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let lastByte = now(), pending: AgentTurnEvent | undefined, done = false, runId: string | undefined, sequence = 0;
  metrics.requestStart = lastByte;
  const current = () => {
    if (options.signal.aborted || controller.signal.aborted) throw new AgentStreamError("aborted");
    if (!options.isCurrent()) { controller.abort(); throw new AgentStreamError("stale_generation"); }
  };
  const resetIdle = () => { if (idle) clearTimeout(idle); idle = setTimeout(abort, options.idleMs ?? 45_000); };
  try {
    current(); resetIdle();
    const response = await (options.fetcher ?? fetch)(endpoint, { method: "POST", redirect: "error", cache: "no-store",
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(options.request), signal: controller.signal });
    current(); metrics.headersMs = now() - metrics.requestStart;
    if (!response.ok) throw new AgentStreamError(`http_${response.status}`);
    if (!response.headers.get("content-type")?.startsWith("text/event-stream") || !response.body) throw new AgentStreamError("invalid_content_type");
    reader = response.body.getReader();
    const parser = new SseFrameParser((name, payload) => {
      current();
      const value: unknown = JSON.parse(payload);
      if (!record(value) || value.v !== 1 || typeof value.runId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.runId) ||
          value.seq !== sequence + 1 || sequence >= 256 || (runId !== undefined && runId !== value.runId) || done) throw new AgentStreamError("invalid_sequence");
      runId = value.runId; sequence++;
      if (name === "done") {
        if (Object.keys(value).some(k => !["v", "runId", "seq"].includes(k)) || !pending) throw new AgentStreamError("missing_final");
        done = true;
      } else if (name === "agent" && !pending && Object.keys(value).every(k => ["v", "runId", "seq", "event"].includes(k)) && validEvent(value.event)) {
        if (value.event.type === "progress") options.onEvent(value.event);
        else {
          pending = value.event;
        }
      } else throw new AgentStreamError("invalid_event");
    });
    for (;;) {
      const result = await reader.read(); current();
      const received = now(); metrics.maxSilenceMs = Math.max(metrics.maxSilenceMs, received - lastByte);
      if (result.done) { parser.finish(); break; }
      metrics.ttfbMs ??= received - metrics.requestStart; lastByte = received; resetIdle();
      parser.push(result.value);
    }
    if (!done || !pending) throw new AgentStreamError("incomplete_stream");
    if (pending.type === "error") throw new AgentStreamError(pending.code);
    current(); options.onEvent(pending); metrics.ttfiMs = now() - metrics.requestStart; metrics.completionMs = now() - metrics.requestStart;
  } catch (error) {
    metrics.maxSilenceMs = Math.max(metrics.maxSilenceMs, now() - lastByte);
    metrics.error = error instanceof AgentStreamError ? error.message : controller.signal.aborted ? "aborted" : "stream_error";
    throw new AgentStreamError(metrics.error);
  } finally {
    metrics.settledMs = now() - metrics.requestStart;
    controller.abort(); clearTimeout(deadline); if (idle) clearTimeout(idle);
    options.signal.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}

/** Bounded incremental UTF-8/SSE framing. Supports CRLF, split frames and coalesced frames. */
export class SseFrameParser {
  private decoder = new TextDecoder("utf-8", { fatal: true });
  private text = "";
  private bytes = 0;
  constructor(private readonly emit: (name: string, payload: string) => void) {}
  push(chunk: Uint8Array) {
    this.bytes += chunk.length;
    if (this.bytes > 1_048_576) throw new AgentStreamError("stream_too_large");
    this.text += this.decoder.decode(chunk, { stream: true });
    this.drain();
  }
  finish() {
    this.text += this.decoder.decode(); this.drain();
    if (this.text.trim()) throw new AgentStreamError("partial_frame");
  }
  private drain() {
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/u.exec(this.text))) {
      const frame = this.text.slice(0, match.index); this.text = this.text.slice(match.index + match[0].length);
      if (frame.length > 65_536) throw new AgentStreamError("frame_too_large");
      const data: string[] = []; let event = "message";
      for (const line of frame.split(/\r?\n/u)) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trimStart();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /u, ""));
        else if (line) throw new AgentStreamError("unsupported_field");
      }
      if (data.length) this.emit(event, data.join("\n"));
    }
    if (this.text.length > 65_536) throw new AgentStreamError("frame_too_large");
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validEvent(event: unknown): event is AgentTurnEvent {
  if (!record(event)) return false;
  if (event.type === "progress") return agentProgressPhases.includes(event.phase as typeof agentProgressPhases[number]) && Object.keys(event).every(k => ["type", "phase"].includes(k));
  if (event.type === "error") return ["agent_failed", "limit_reached", "turn_conflict"].includes(String(event.code)) && Object.keys(event).every(k => ["type", "code"].includes(k));
  try { if (event.publicPlanPresentation !== undefined) parsePublicPlanPresentation(event.publicPlanPresentation); if (event.publicJourneyPresentation !== undefined) parsePublicJourneyPresentation(event.publicJourneyPresentation); if (event.researchExecution !== undefined) parseResearchExecutionOutcome(event.researchExecution); if (event.tripCostProposal !== undefined) parsePublicCostProposal(event.tripCostProposal); if ((event.tripUpdateProposal || event.tripCostProposal) && event.consultationRequestProposal) return false; if (event.consultationRequestProposal !== undefined) parseConsultationRequestProposal(event.consultationRequestProposal); if (event.tripUpdateProposal !== undefined) parsePublicRequestProposal(event.tripUpdateProposal); } catch { return false; }
  return event.type === "final" && ["completed", "follow_up"].includes(String(event.status)) && typeof event.response === "string" &&
    event.response.length <= 32_000 && Object.keys(event).every(k => ["type", "status", "response", "publicPlanPresentation", "publicJourneyPresentation", "researchExecution", "tripUpdateProposal", "consultationRequestProposal", "tripCostProposal"].includes(k));
}
