import { recoverConversationTurn } from "./recovery";
import type { AssistantTurnView } from "../../../domain/assistant-turn-view";
import type { AuthSession } from "../../../usecases/auth/auth-session";
import { ApiAuthenticationError } from "../../../usecases/auth/api-authentication-error";
import { consumeAgentStream, AgentStreamError, type StreamMeasurement } from "./consumer";
import type { BrowserAgentDiagnostics } from "./diagnostics";
import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";
import { projectAssistantTurn } from "../../../usecases/concierge/assistant-turn-projection";

export interface ConversationStreamRequest {
  conversationId: string;
  turnId: string;
  userRequest: string;
  requestedResearchMode?: "standard" | "detailed";
  researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number };
  tripId?: string;
  uiContext?: { itemId?: string; calendarDate?: string };
}
export interface ConversationStreamReferences {
  conversationId: string;
  tripId?: string;
  itemId?: string;
  tripRevision?: number;
  /** Legacy numeric draft revision for callers that have one. */
  draftRevision?: number;
  /** Content version of the unsaved consultation request; metadata changes must not cancel a turn. */
  draftRequestVersion?: string;
}
/** Transport only. An action owns one immutable turn ID; retry never regenerates it. */
export function createConversationStreamSession(options: {
  auth: AuthSession; references: () => ConversationStreamReferences;
  endpoint?: string; fetcher?: typeof fetch; newTurnId?: () => string; now?: () => Date;
  diagnostics?: BrowserAgentDiagnostics;
}) {
  let authGeneration = 0, conversationGeneration = 0, tripGeneration = 0, requestGeneration = 0;
  let refs = options.references(), active: AbortController | undefined;
  const unsubscribe = options.auth.subscribe(() => { authGeneration++; active?.abort("auth_changed"); });
  const sync = () => {
    const next = options.references();
    if (next.conversationId !== refs.conversationId) { conversationGeneration++; active?.abort("conversation_changed"); }
    if (next.tripId !== refs.tripId || next.tripRevision !== refs.tripRevision ||
        next.draftRevision !== refs.draftRevision || next.draftRequestVersion !== refs.draftRequestVersion) {
      tripGeneration++;
      active?.abort("trip_changed");
    }
    refs = { ...next };
  };
  const version = () => `${authGeneration}:${conversationGeneration}:${tripGeneration}`;
  return {
    contextVersion() { sync(); return version(); },
    contextChanged: sync,
    start(userRequest: string, requestedResearchMode: "standard" | "detailed" = "standard", researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number }) {
      sync(); active?.abort("request_replaced"); const requestVersion = ++requestGeneration, contextVersion = version();
      if (researchTarget && ((researchTarget.tripId !== undefined && researchTarget.tripId !== refs.tripId) ||
          (researchTarget.baseTripRevision !== undefined && researchTarget.baseTripRevision !== refs.tripRevision))) throw new AgentStreamError("stale_generation");
      // Deliberate projection: callers cannot send history, Profile, Trip bodies or Tool data.
      const request: ConversationStreamRequest = { conversationId: refs.conversationId, turnId: (options.newTurnId ?? (() => crypto.randomUUID()))(), userRequest,
        requestedResearchMode,
        ...(researchTarget ? { researchTarget: { ...researchTarget, ...(refs.tripId ? { tripId: refs.tripId } : {}),
          ...(refs.tripRevision === undefined ? {} : { baseTripRevision: refs.tripRevision }) } } : {}),
        ...(refs.tripId ? { tripId: refs.tripId } : {}), uiContext: {
          ...(refs.itemId ? { itemId: refs.itemId } : {}), calendarDate: localCalendarDate(options.now?.() ?? new Date()),
        } };
      const current = () => { sync(); return contextVersion === version() && requestVersion === requestGeneration; };
      let inFlight = false;
      return {
        request: structuredClone(request),
        async send(onEvent?: (event: AgentTurnEvent) => void): Promise<AssistantTurnView> {
          if (inFlight || !current()) throw new AgentStreamError("stale_generation");
          inFlight = true; const controller = new AbortController(); active = controller;
          const diagnosticEpoch = options.diagnostics?.contextVersion(), began = performance.now();
          let measurement: StreamMeasurement = { requestStart: 0, maxSilenceMs: 0 };
          try {
            let token = await options.auth.getAccessToken();
            if (!current()) throw new AgentStreamError("stale_generation");
            if (!token || options.auth.getState().status !== "signed-in") throw new ApiAuthenticationError("unauthenticated");
            if (!current()) throw new AgentStreamError("stale_generation");
            options.diagnostics?.authorize(token);
            let final: AssistantTurnView | undefined;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                measurement = { requestStart: 0, maxSilenceMs: 0 };
                await consumeAgentStream({ token, request, endpoint: options.endpoint ?? "/api/agent-stream", fetcher: options.fetcher,
                  signal: controller.signal, isCurrent: current, measurement,
                  onEvent(event) { if (!current()) return; if (event.type === "final") {
                    final = projectAssistantTurn(event);
                  } onEvent?.(event); },
                });
                break;
              } catch (error) {
                if (error instanceof AgentStreamError && measurement.runId && current() &&
                    (measurement.abortReason === "idle_timeout" || ["missing_final", "incomplete_stream", "stream_error"].includes(error.message))) {
                  options.diagnostics?.record(error, measurement, request.turnId, diagnosticEpoch);
                  const recovered = await recoverConversationTurn({ token, conversationId: request.conversationId, turnId: request.turnId,
                    signal: controller.signal, isCurrent: current, fetcher: options.fetcher, deadlineMs: Math.max(1, 270_000 - (performance.now() - began)) });
                  if (!current()) throw new AgentStreamError("stale_generation");
                  if (recovered) { final = projectAssistantTurn(recovered); onEvent?.(recovered); break; }
                }
                if (!(error instanceof AgentStreamError) || error.message !== "http_401" || attempt !== 0) throw error;
                const refreshed = await options.auth.refreshAccessToken(token);
                if (!current()) throw new AgentStreamError("stale_generation");
                if (!refreshed || refreshed === token || options.auth.getState().status !== "signed-in") { options.auth.invalidate(); throw new ApiAuthenticationError("unauthenticated"); }
                token = refreshed;
                options.diagnostics?.authorize(token);
              }
            }
            if (!current()) throw new AgentStreamError("stale_generation");
            if (final === undefined) throw new AgentStreamError("missing_final");
            return final;
          } catch (error) {
            measurement.settledMs ??= performance.now() - began;
            options.diagnostics?.record(error, measurement, request.turnId, diagnosticEpoch);
            if (!current()) throw new AgentStreamError("stale_generation");
            if (error instanceof AgentStreamError && error.message === "http_401") { options.auth.invalidate(); throw new ApiAuthenticationError("unauthenticated"); }
            if (error instanceof AgentStreamError && error.message === "http_403") throw new ApiAuthenticationError("forbidden");
            throw error;
          } finally { inFlight = false; if (active === controller) active = undefined; }
        },
      };
    },
    dispose() { unsubscribe(); requestGeneration++; active?.abort("disposed"); },
  };
}

function localCalendarDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
