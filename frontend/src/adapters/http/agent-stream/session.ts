import type { ViewerAgentResponse } from "../../../domain/viewer-agent-response";
import type { AuthSession } from "../../../usecases/auth/auth-session";
import { ApiAuthenticationError } from "../../../usecases/auth/api-authentication-error";
import { consumeAgentStream, AgentStreamError } from "./consumer";
import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";

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
}) {
  let authGeneration = 0, conversationGeneration = 0, tripGeneration = 0, requestGeneration = 0;
  let refs = options.references(), active: AbortController | undefined;
  const unsubscribe = options.auth.subscribe(() => { authGeneration++; active?.abort(); });
  const sync = () => {
    const next = options.references();
    if (next.conversationId !== refs.conversationId) { conversationGeneration++; active?.abort(); }
    if (next.tripId !== refs.tripId || next.tripRevision !== refs.tripRevision ||
        next.draftRevision !== refs.draftRevision || next.draftRequestVersion !== refs.draftRequestVersion) {
      tripGeneration++;
      active?.abort();
    }
    refs = { ...next };
  };
  const version = () => `${authGeneration}:${conversationGeneration}:${tripGeneration}`;
  return {
    contextVersion() { sync(); return version(); },
    contextChanged: sync,
    start(userRequest: string, requestedResearchMode: "standard" | "detailed" = "standard", researchTarget?: { presentationId: string; candidateSetId?: string; candidateSetRevision?: number; tripId?: string; baseTripRevision?: number }) {
      sync(); active?.abort(); const requestVersion = ++requestGeneration, contextVersion = version();
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
        async send(onEvent?: (event: AgentTurnEvent) => void): Promise<ViewerAgentResponse> {
          if (inFlight || !current()) throw new AgentStreamError("stale_generation");
          inFlight = true; const controller = new AbortController(); active = controller;
          try {
            let token = await options.auth.getAccessToken();
            if (!current()) throw new AgentStreamError("stale_generation");
            if (!token || options.auth.getState().status !== "signed-in") throw new ApiAuthenticationError("unauthenticated");
            if (!current()) throw new AgentStreamError("stale_generation");
            let final: ViewerAgentResponse | undefined;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                await consumeAgentStream({ token, request, endpoint: options.endpoint ?? "/api/agent-stream", fetcher: options.fetcher,
                  signal: controller.signal, isCurrent: current, measurement: { requestStart: 0, maxSilenceMs: 0 },
                  onEvent(event) { if (!current()) return; if (event.type === "final") final = event.publicPlanPresentation ? { text: event.response, publicPlanPresentation: event.publicPlanPresentation } : event.tripCostProposal ? { text: event.response, tripCostProposal: event.tripCostProposal, ...(event.tripUpdateProposal ? { tripUpdateProposal: event.tripUpdateProposal } : {}) } : event.consultationRequestProposal ? { text: event.response, consultationRequestProposal: event.consultationRequestProposal } : event.tripUpdateProposal ? { text: event.response, tripUpdateProposal: event.tripUpdateProposal } : event.response; onEvent?.(event); },
                });
                break;
              } catch (error) {
                if (!(error instanceof AgentStreamError) || error.message !== "http_401" || attempt !== 0) throw error;
                const refreshed = await options.auth.refreshAccessToken(token);
                if (!current()) throw new AgentStreamError("stale_generation");
                if (!refreshed || refreshed === token || options.auth.getState().status !== "signed-in") { options.auth.invalidate(); throw new ApiAuthenticationError("unauthenticated"); }
                token = refreshed;
              }
            }
            if (!current()) throw new AgentStreamError("stale_generation");
            if (final === undefined) throw new AgentStreamError("missing_final");
            return final;
          } catch (error) {
            if (!current()) throw new AgentStreamError("stale_generation");
            if (error instanceof AgentStreamError && error.message === "http_401") { options.auth.invalidate(); throw new ApiAuthenticationError("unauthenticated"); }
            if (error instanceof AgentStreamError && error.message === "http_403") throw new ApiAuthenticationError("forbidden");
            throw error;
          } finally { inFlight = false; if (active === controller) active = undefined; }
        },
      };
    },
    dispose() { unsubscribe(); requestGeneration++; active?.abort(); },
  };
}

function localCalendarDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
