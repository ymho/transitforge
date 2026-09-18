import type { AuthSession } from "../../../usecases/auth/auth-session";
import { ApiAuthenticationError } from "../../../usecases/auth/api-authentication-error";
import { consumeAgentStream, AgentStreamError } from "./consumer";
import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";

export interface ConversationStreamRequest {
  conversationId: string;
  turnId: string;
  userRequest: string;
  tripId?: string;
  uiContext?: { itemId?: string };
}
export interface ConversationStreamReferences { conversationId: string; tripId?: string; itemId?: string; tripRevision?: number }
/** Transport only. An action owns one immutable turn ID; retry never regenerates it. */
export function createConversationStreamSession(options: {
  auth: AuthSession; references: () => ConversationStreamReferences;
  endpoint?: string; fetcher?: typeof fetch; newTurnId?: () => string;
}) {
  let authGeneration = 0, conversationGeneration = 0, tripGeneration = 0, requestGeneration = 0;
  let refs = options.references(), active: AbortController | undefined;
  const unsubscribe = options.auth.subscribe(() => { authGeneration++; active?.abort(); });
  const sync = () => {
    const next = options.references();
    if (next.conversationId !== refs.conversationId) { conversationGeneration++; active?.abort(); }
    if (next.tripId !== refs.tripId || next.tripRevision !== refs.tripRevision) { tripGeneration++; active?.abort(); }
    refs = { ...next };
  };
  const version = () => `${authGeneration}:${conversationGeneration}:${tripGeneration}`;
  return {
    contextVersion() { sync(); return version(); },
    contextChanged: sync,
    start(userRequest: string) {
      sync(); active?.abort(); const requestVersion = ++requestGeneration, contextVersion = version();
      // Deliberate projection: callers cannot send history, Profile, Trip bodies or Tool data.
      const request: ConversationStreamRequest = { conversationId: refs.conversationId, turnId: (options.newTurnId ?? (() => crypto.randomUUID()))(), userRequest,
        ...(refs.tripId ? { tripId: refs.tripId } : {}), ...(refs.itemId ? { uiContext: { itemId: refs.itemId } } : {}) };
      const current = () => { sync(); return contextVersion === version() && requestVersion === requestGeneration; };
      let inFlight = false;
      return {
        request: structuredClone(request),
        async send(onEvent?: (event: AgentTurnEvent) => void): Promise<string> {
          if (inFlight || !current()) throw new AgentStreamError("stale_generation");
          inFlight = true; const controller = new AbortController(); active = controller;
          try {
            const token = await options.auth.getAccessToken();
            if (!current()) throw new AgentStreamError("stale_generation");
            if (!token || options.auth.getState().status !== "signed-in") throw new ApiAuthenticationError("unauthenticated");
            if (!current()) throw new AgentStreamError("stale_generation");
            let final: string | undefined;
            await consumeAgentStream({ token, request, endpoint: options.endpoint ?? "/api/agent-stream", fetcher: options.fetcher,
              signal: controller.signal, isCurrent: current, measurement: { requestStart: 0, maxSilenceMs: 0 },
              onEvent(event) { if (!current()) return; if (event.type === "final") final = event.response; onEvent?.(event); },
            });
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
