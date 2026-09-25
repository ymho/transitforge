import { createAgentContextSnapshot, selectedTripItemSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { boundAgentConversationContext, type AgentConversationContext, type AgentRuntimeContextInput } from "@raiquora/agent/agent-decision-context";
import type { TrustedPrincipal } from "../../contracts/trusted-principal.js";
import { StateError, requireStatePrincipal, stateId, type Conversation } from "../../contracts/server-state.js";
import type { TripRepository } from "../../ports/trip-repository.js";
import type { ConversationApplication } from "../conversation-application.js";
import type { ProfileApplication } from "../profile-application.js";
import type { ConversationTurnRepository } from "../../ports/conversation-turn-repository.js";
import { deriveAgentTaskContext } from "@raiquora/agent/agent-task-context";
import { compileEffectiveIntent, effectiveProfileContext } from "@raiquora/agent/effective-intent";

export const serverStateContextLimits = { historyMessages: 12, conversationJsonCharacters: 12_000 } as const;
export interface ServerStateContextReferences {
  principal: TrustedPrincipal;
  conversationId?: string;
  tripId?: string;
  uiContext?: { itemId?: string; calendarDate?: string };
}
export interface ServerStateContextReaders {
  conversations: Pick<ConversationApplication, "get" | "history">;
  profiles: Pick<ProfileApplication, "get">;
  /** Owner-scoped Trip V2 read, not a global ID lookup or a request-selected owner. */
  trips: Pick<TripRepository, "get">;
  workingStates?: Pick<ConversationTurnRepository, "getWorkingState">;
}

/** Read-only and per-turn. No cache, message append, transport or model dependencies. */
export function createServerStateContextLoader(readers: ServerStateContextReaders, options: { historyBeforeSequence?: number; onTrip?: (trip: import("@raiquora/trip/trip").Trip) => void; onConsultation?: (value: { conversationId: string; createdAt: string; request: import("@raiquora/trip/trip-request").TripRequest }) => void } = {}) {
  const before = options.historyBeforeSequence;
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new StateError("invalid-input");
  return async (input: ServerStateContextReferences): Promise<AgentRuntimeContextInput> => {
    requireStatePrincipal(input.principal);
    if (input.conversationId !== undefined) stateId(input.conversationId);
    if (input.tripId !== undefined) stateId(input.tripId);
    const itemId = input.uiContext?.itemId;
    if (itemId !== undefined && (typeof itemId !== "string" || !itemId.trim() || itemId.length > 200 || /[\u0000-\u001f\u007f]/u.test(itemId))) throw new StateError("invalid-input");
    const calendarDate = input.uiContext?.calendarDate;
    if (calendarDate !== undefined && !validCalendarDate(calendarDate)) throw new StateError("invalid-input");
    // Snapshot only allowlisted references before awaiting. Caller mutations cannot switch account/Trip.
    const principal = structuredClone(input.principal), conversationId = input.conversationId, explicitTripId = input.tripId;
    const conversation = conversationId ? await readers.conversations.get(principal, conversationId) : undefined;
    if (conversation?.tripId && explicitTripId && conversation.tripId !== explicitTripId) throw new StateError("invalid-input");
    const tripId = conversation?.tripId ?? explicitTripId;
    const trip = tripId ? await readers.trips.get(principal, tripId) : undefined;
    if (tripId && !trip) throw new StateError("not-found");
    const profile = await readers.profiles.get(principal);
    const history = conversation ? await recentConversation(readers.conversations, principal, conversation, before) : undefined;
    if (trip) options.onTrip?.(structuredClone(trip));
    const persistedConsultationRequest = !trip && conversation ? conversation.draftRequest : undefined;
    const consultationRequest = !trip && conversation ? persistedConsultationRequest ?? { constraints: [], assumptions: [] } : undefined;
    // The empty proposal base enables the first consultation write; phase derivation still distinguishes it from persisted draft state.
    if (conversation && consultationRequest) options.onConsultation?.({ conversationId: conversation.conversationId, createdAt: conversation.createdAt,
      request: structuredClone(consultationRequest) });
    // Profile is resolved through EffectiveIntent below; do not expose a second
    // raw snapshot whose precedence would be left to the model.
    const snapshot = createAgentContextSnapshot(undefined, trip);
    const savedWorkingState = conversation && readers.workingStates
      ? await readers.workingStates.getWorkingState(principal, conversation.conversationId) : undefined;
    const workingState = savedWorkingState && (!tripId || savedWorkingState.target.tripId === undefined ||
      savedWorkingState.target.tripId === tripId && (savedWorkingState.target.tripRevision === undefined || savedWorkingState.target.tripRevision === trip?.revision))
      ? savedWorkingState : undefined;
    const taskContext = conversationId || trip || consultationRequest ? deriveAgentTaskContext({ conversationId, trip: trip ? { id: trip.id, revision: trip.revision,
      lifecycleState: trip.lifecycleState } : undefined,
      consultationRequest: persistedConsultationRequest, requestRevision: trip?.revision ?? conversation?.revision,
      workingStateRevision: workingState?.revision, previousOutcome: workingState?.lastOutcome?.outcome }) : undefined;
    const receiptCandidate = before !== undefined && workingState?.sourceUserSequence === before
      ? workingState.semantic?.receipts.at(-1) : undefined;
    const currentIntentReceipt = receiptCandidate?.intentRevision === workingState?.semantic?.overlay.intentRevision
      ? receiptCandidate : undefined;
    const acceptedIntentOperations = currentIntentReceipt?.operations.filter(({ status }) => status === "accepted") ?? [];
    const taskContextWithIntent = taskContext && currentIntentReceipt && acceptedIntentOperations.length ? { ...taskContext,
      currentIntentChange: { intentRevision: currentIntentReceipt.intentRevision, speechAct: currentIntentReceipt.speechAct,
        operations: acceptedIntentOperations.map(({ action, target, frame }) => ({ action, target, frame })) },
    } : taskContext;
    const effectiveIntent = workingState?.semantic || trip?.request || consultationRequest || profile?.profile ? compileEffectiveIntent({
      ...(trip?.request ? { baseRequest: trip.request, baseSource: "trip" as const } : consultationRequest ? {
        baseRequest: consultationRequest, baseSource: "conversation_draft" as const,
      } : {}),
      ...(taskContext?.requestRevision === undefined ? {} : { baseRevision: taskContext.requestRevision }),
      ...(profile?.profile ? { profile: profile.profile, profileRevision: profile.revision } : {}),
      overlay: workingState?.semantic?.overlay ?? { version: 1, intentRevision: 0, facts: [], tombstones: [], appliedMutationIds: [] },
    }) : undefined;
    const effectiveProfile = effectiveIntent ? effectiveProfileContext(effectiveIntent) : undefined;
    const focusedItem = itemId ? trip?.items.find((item) => item.id === itemId) : undefined;
    return {
      ...(taskContextWithIntent ? { taskContext: taskContextWithIntent } : {}),
      ...(effectiveIntent ? { effectiveIntent } : {}),
      ...(workingState ? { workingState, previousAssistantTurn: workingState.lastOutcome?.outcome } : {}),
      ...(history ? { conversation: history } : {}),
      ...(effectiveProfile ? { travelProfile: effectiveProfile } : {}),
      ...(snapshot.trip ? { currentTrip: snapshot.trip } : {}),
      ...(consultationRequest ? { consultationRequest } : {}),
      ...(focusedItem || calendarDate ? { featureContext: {
        ...(focusedItem ? { uiFocus: { itemId: focusedItem.id, item: selectedTripItemSnapshot(focusedItem) } } : {}),
        ...(calendarDate ? { calendarDate } : {}),
      } } : {}),
    };
  };
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function recentConversation(readers: ServerStateContextReaders["conversations"], principal: TrustedPrincipal, conversation: Conversation, before?: number) {
  const end = Math.min(conversation.messageCount, before === undefined ? conversation.messageCount : before - 1);
  const start = Math.max(0, end - serverStateContextLimits.historyMessages);
  let last = start;
  const messages: NonNullable<AgentConversationContext["messages"]> = [];
  // Seek into the tail using the existing sequence cursor, never scan earlier history.
  // At most 12 rows/pages even if DynamoDB ends a page at its byte limit.
  while (last < end) {
    const page = await readers.history(principal, conversation.conversationId, {
      after: String(last).padStart(12, "0"), limit: end - last,
    });
    if (!page.items.length) throw new StateError("conflict");
    for (const message of page.items) {
      if (message.sequence !== last + 1 || message.sequence > end) throw new StateError("conflict");
      messages.push({ role: message.role, text: message.text }); last = message.sequence;
    }
  }
  // Metadata/reference and history must belong to one conversation revision, including an empty history.
  const latest = await readers.get(principal, conversation.conversationId);
  if (latest.revision !== conversation.revision) throw new StateError("conflict");
  const context = boundAgentConversationContext({ title: conversation.title, scope: conversation.scope, summary: conversation.summary, resolvedTopics: conversation.resolvedTopics,
    pendingTopics: conversation.pendingTopics, messages });
  // Account for JSON escaping too. Prefer summary and recent history over older turns.
  while (JSON.stringify(context).length > serverStateContextLimits.conversationJsonCharacters) {
    if (context.messages!.length > 1) context.messages!.shift();
    else if (context.resolvedTopics!.length) context.resolvedTopics!.shift();
    else if (context.pendingTopics!.length) context.pendingTopics!.shift();
    else if (context.messages!.length) context.messages![0].text = context.messages![0].text.slice(0, Math.floor(context.messages![0].text.length / 2));
    else throw new StateError("unavailable"); // Shared summary limit alone is below this budget.
  }
  return context;
}
