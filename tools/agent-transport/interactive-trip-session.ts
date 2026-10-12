import { randomUUID } from "node:crypto";
import type { AgentTurnEvent } from "@raiquora/agent/agent-progress";
import { consumeAgentStream, type StreamMeasurement } from "../../frontend/src/adapters/http/agent-stream/consumer.js";
import { HttpServerTripClient } from "../../frontend/src/adapters/http/server-trip-client.js";
import { HttpServerConversationClient } from "../../frontend/src/adapters/http/server-conversation-client.js";
import type { PlanAdoptionTarget } from "../../frontend/src/usecases/trip-plan/server-trip-client.js";
import type { ItemDecisionTarget, TripAdoptionTarget, TripMutationRequest } from "../../frontend/src/usecases/trip-plan/server-trip-client.js";
import { applyTripProposal } from "@raiquora/trip/trip";
import { validateMutation } from "../../backend/agent-api/src/contracts/trip-api.js";

type Command =
  | { action: "start"; title: string; reason: string }
  | { action: "use"; sessionId: string; reason: string }
  | { action: "say"; message: string; reason: string; itemId?: string }
  | { action: "retry" | "inspect"; reason: string }
  | { action: "edit"; proposal: TripMutationRequest["proposal"]; reason: string }
  | { action: "retry-edit"; reason: string }
  | { action: "preview-item"; itemId: string; decision: "confirm" | "withdraw"; reason: string }
  | { action: "preview-trip"; decision: "confirm" | "withdraw"; reason: string }
  | { action: "preview"; candidateSetId: string; candidateSetRevision: number; variantId: string; reason: string }
  | { action: "confirm"; reason: string };
type Request = Parameters<typeof consumeAgentStream>[0]["request"];
interface Session { tripId: string; conversationId: string; lastRequest?: Request; lastEdit?: TripMutationRequest;
  preview?: { kind: "plan"; target: PlanAdoptionTarget; key: string } | { kind: "item"; target: ItemDecisionTarget; key: string } |
    { kind: "trip"; target: TripAdoptionTarget; key: string } }

/** Testing controller only. The evaluator chooses each next command after reading
 * the previous observation; there is no model impersonation, canned reply or
 * alternative save path. All mutations go through the existing public APIs. */
export function createInteractiveTripSession(options: {
  origin: string; token: () => Promise<string>; fetcher?: typeof fetch;
  maxTurns?: number; now?: () => Date; newId?: () => string;
  readInternal?: (target: { tripId: string; conversationId: string; turnId?: string }) => Promise<unknown>;
  signal?: AbortSignal;
}) {
  const origin = new URL(options.origin);
  if (origin.href !== `${origin.origin}/` || origin.username || origin.password ||
      origin.protocol !== "https:" && !(origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname))) throw new Error("invalid_origin");
  const maximum = options.maxTurns ?? 64;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 80) throw new Error("invalid_turn_budget");
  const newId = options.newId ?? randomUUID, now = options.now ?? (() => new Date());
  let turns = 0, starts = 0, actions = 0, busy = false, current: Session | undefined;
  const sessions = new Map<string, Session>();
  let transport: { path: string; status: number | null; stage: "authentication" | "transport" | "http" }[] = [];
  const request: typeof fetch = async (input, init) => {
    const path = String(input);
    if (!["/api/trips/v1", "/api/conversations/v1", "/api/agent-stream"].includes(path)) throw new Error("invalid_endpoint");
    let token: string;
    try { token = await options.token(); if (!token.trim() || /\s/u.test(token)) throw new Error(); }
    catch { transport.push({ path, status: null, stage: "authentication" }); throw new Error("authentication_unavailable"); }
    const headers = new Headers(init?.headers); headers.set("authorization", `Bearer ${token}`);
    try {
      const response = await (options.fetcher ?? fetch)(new URL(path, origin), { ...init, headers,
        ...(options.signal ? { signal: AbortSignal.any([options.signal, ...(init?.signal ? [init.signal] : [])]) } : {}), redirect: "error", cache: "no-store" });
      transport.push({ path, status: response.status, stage: "http" }); return response;
    } catch { transport.push({ path, status: null, stage: "transport" }); throw new Error("transport_unavailable"); }
  };
  const trips = new HttpServerTripClient("/api/trips/v1", request);
  const conversations = new HttpServerConversationClient("/api/conversations/v1", request);
  async function snapshot(session: Session) {
    const trip = await trips.get(session.tripId);
    const history = [];
    let after: string | undefined;
    for (let page = 0; page < 4; page++) {
      const result = await conversations.history(session.conversationId, { limit: 50, ...(after ? { after } : {}) });
      history.push(...result.items);
      if (!result.nextAfter) return { trip, history, historyComplete: true };
      if (result.nextAfter === after) throw new Error("invalid_history_cursor");
      after = result.nextAfter;
    }
    return { trip, history, historyComplete: false };
  }
  async function observe(session: Session) {
    let result: { savedState?: Awaited<ReturnType<typeof snapshot>>; stateReadError?: string };
    try { result = { savedState: await snapshot(session) }; }
    catch { result = { stateReadError: "saved_state_unavailable" }; }
    if (!options.readInternal) return result;
    try { return { ...result, internalState: await options.readInternal({ tripId: session.tripId, conversationId: session.conversationId,
      ...(session.lastRequest?.turnId ? { turnId: session.lastRequest.turnId } : {}) }) }; }
    catch { return { ...result, internalStateReadError: "internal_state_unavailable" }; }
  }
  async function send(session: Session, body: Request) {
    if (turns >= maximum) throw new Error("turn_budget_exhausted");
    turns++;
    const events: AgentTurnEvent[] = [], measurement: StreamMeasurement = { requestStart: 0, maxSilenceMs: 0 };
    let error: string | undefined;
    try {
      await consumeAgentStream({ request: body, token: "injected-by-transport", fetcher: request,
        endpoint: "/api/agent-stream", signal: options.signal ?? new AbortController().signal, isCurrent: () => true,
        measurement, onEvent: event => events.push(event) });
    } catch { error = measurement.error ?? "stream_error"; }
    return { request: body, events, measurement, ...(error ? { error } : {}), ...await observe(session) };
  }
  return {
    transportObservations: () => structuredClone(transport),
    async execute(value: unknown) {
      const command = parseInteractiveTripCommand(value);
      if (busy) throw new Error("command_in_progress");
      transport = [];
      if (++actions > 200) throw new Error("action_budget_exhausted");
      busy = true;
      try {
        if (command.action === "start") {
          if (++starts > 12) throw new Error("session_budget_exhausted");
          const id = newId();
          const started: Session = { tripId: id, conversationId: id };
          current = started; sessions.set(id, started);
          try {
            const result = await trips.startConsultation({ tripId: id, title: command.title });
            if ("status" in result) { sessions.delete(id); current = undefined; return { sessionId: id, scopeResult: result }; }
            started.conversationId = result.conversationId;
            return { sessionId: id, ...await observe(started) };
          } catch { return { sessionId: id, error: "session_start_unconfirmed", ...await observe(started) }; }
        }
        if (command.action === "use") {
          const session = sessions.get(command.sessionId); if (!session) throw new Error("unknown_session");
          current = session;
        }
        const session = current; if (!session) throw new Error("no_session");
        if (command.action === "inspect" || command.action === "use") return { sessionId: session.tripId, ...await observe(session) };
        if (command.action === "edit" || command.action === "retry-edit") {
          session.preview = undefined;
          if (command.action === "edit") {
            const trip = await trips.get(session.tripId);
            if (!trip || command.proposal.tripId !== session.tripId || command.proposal.baseRevision !== trip.revision) throw new Error("stale_edit_target");
            applyTripProposal(trip, command.proposal);
            session.lastEdit = { tripId: session.tripId, baseRevision: trip.revision, mutationId: newId(), proposal: command.proposal };
          }
          if (!session.lastEdit) throw new Error("no_previous_edit");
          const saved = await trips.mutate(session.lastEdit);
          return { sessionId: session.tripId, savedTrip: saved, ...await observe(session) };
        }
        if (command.action === "say") {
          if (turns >= maximum) throw new Error("turn_budget_exhausted");
          session.preview = undefined;
          session.lastRequest = { conversationId: session.conversationId, tripId: session.tripId, turnId: newId(), userRequest: command.message,
            requestedResearchMode: "standard", uiContext: { calendarDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now()),
              ...(command.itemId ? { itemId: command.itemId } : {}) } };
          return { sessionId: session.tripId, ...await send(session, session.lastRequest) };
        }
        if (command.action === "retry") {
          if (!session.lastRequest) throw new Error("no_previous_turn");
          session.preview = undefined;
          return { sessionId: session.tripId, ...await send(session, session.lastRequest) };
        }
        if (command.action === "preview") {
          session.preview = undefined;
          const trip = await trips.get(session.tripId); if (!trip) throw new Error("trip_unavailable");
          const target = { conversationId: session.conversationId, tripId: session.tripId, baseTripRevision: trip.revision,
            mutationId: newId(), candidateSetId: command.candidateSetId, candidateSetRevision: command.candidateSetRevision, variantId: command.variantId };
          const result = await trips.previewPlanAdoption(target);
          session.preview = { kind: "plan", target, key: result.confirmationKey };
          // Keep the server confirmation capability inside the testing controller.
          return { sessionId: session.tripId, preview: result.preview, ...await observe(session) };
        }
        if (command.action === "preview-item" || command.action === "preview-trip") {
          session.preview = undefined;
          const trip = await trips.get(session.tripId); if (!trip) throw new Error("trip_unavailable");
          const target = { tripId: session.tripId, baseTripRevision: trip.revision, mutationId: newId(), action: command.decision };
          if (command.action === "preview-item") {
            if (!trip.items.some(item => item.id === command.itemId)) throw new Error("unknown_item");
            const itemTarget = { ...target, itemId: command.itemId };
            const result = await trips.previewItemDecision(itemTarget);
            session.preview = { kind: "item", target: itemTarget, key: result.confirmationKey };
            return { sessionId: session.tripId, preview: result.preview, ...await observe(session) };
          }
          const result = await trips.previewTripAdoption(target);
          session.preview = { kind: "trip", target, key: result.confirmationKey };
          return { sessionId: session.tripId, preview: result.preview, ...await observe(session) };
        }
        if (!session.preview) throw new Error("no_adoption_preview");
        const saved = session.preview.kind === "plan" ? await trips.confirmPlanAdoption(session.preview.target, session.preview.key) :
          session.preview.kind === "item" ? await trips.confirmItemDecision(session.preview.target, session.preview.key) :
            await trips.confirmTripAdoption(session.preview.target, session.preview.key);
        session.preview = undefined;
        return { sessionId: session.tripId, savedTrip: saved, ...await observe(session) };
      } finally { busy = false; }
    },
  };
}

export function parseInteractiveTripCommand(value: unknown): Command {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_command");
  const v = value as Record<string, unknown>;
  const keys: Record<string, string[]> = { start: ["title"], use: ["sessionId"], say: ["message", "itemId"], retry: [], inspect: [],
    edit: ["proposal"], "retry-edit": [], "preview-item": ["itemId", "decision"], "preview-trip": ["decision"],
    preview: ["candidateSetId", "candidateSetRevision", "variantId"], confirm: [] };
  if (typeof v.action !== "string" || !Object.hasOwn(keys, v.action) || typeof v.reason !== "string" || !v.reason.trim() || v.reason.length > 2000 ||
      Object.keys(v).some(key => !["action", "reason", ...keys[v.action as string]!].includes(key))) throw new Error("invalid_command");
  for (const key of keys[v.action]!) {
    if (key === "proposal") {
      const proposal = v.proposal as TripMutationRequest["proposal"];
      validateMutation({ tripId: proposal?.tripId, baseRevision: proposal?.baseRevision, mutationId: "00000000-0000-4000-8000-000000000001", proposal });
    }
    else if (key === "candidateSetRevision") { if (!Number.isSafeInteger(v[key]) || Number(v[key]) < 0) throw new Error("invalid_command"); }
    else if (!(key === "itemId" && v[key] === undefined) &&
      (typeof v[key] !== "string" || !v[key].trim() || (v[key] as string).length > (key === "message" ? 32000 : 160))) throw new Error("invalid_command");
  }
  if (v.decision !== undefined && !["confirm", "withdraw"].includes(String(v.decision))) throw new Error("invalid_command");
  return v as unknown as Command;
}
