import { createAgentContextSnapshot, selectedTripItemSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { boundAgentConversationContext, type AgentConversationContext, type AgentRuntimeContextInput } from "@raiquora/agent/agent-runtime-context";
import type { TrustedPrincipal } from "../../contracts/trusted-principal.js";
import { StateError, requireStatePrincipal, stateId, type Conversation } from "../../contracts/server-state.js";
import type { TripRepository } from "../../ports/trip-repository.js";
import type { ConversationApplication } from "../conversation-application.js";
import type { ProfileApplication } from "../profile-application.js";
import type { ConversationTurnRepository } from "../../ports/conversation-turn-repository.js";
import { deriveAgentTaskContext } from "@raiquora/agent/agent-task-context";
import { compileEffectiveIntent, effectiveProfileContext } from "@raiquora/agent/effective-intent";
import type { IntentApplicationReceipt } from "@raiquora/agent/conversation-intent-reducer";
import type { EffectiveIntent } from "@raiquora/agent/effective-intent";
import { summarizeConditionReceipts } from "@raiquora/agent/conversation-condition";

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
export function createServerStateContextLoader(readers: ServerStateContextReaders, options: { historyBeforeSequence?: number; onTrip?: (trip: import("@raiquora/trip/trip").Trip) => void;
  onConversationMessages?: (messages: import("../../contracts/server-state.js").ConversationMessage[]) => void;
  onEffectiveIntent?: (value: { effectiveIntent: EffectiveIntent; currentReceipt?: IntentApplicationReceipt }) => void } = {}) {
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
    const history = conversation ? await recentConversation(readers.conversations, principal, conversation, before, options.onConversationMessages) : undefined;
    if (trip) options.onTrip?.(structuredClone(trip));
    if (conversation && !trip) throw new StateError("not-found");
    // Profile is resolved through EffectiveIntent below; do not expose a second
    // raw snapshot whose precedence would be left to the model.
    const snapshot = createAgentContextSnapshot(undefined, trip);
    const savedWorkingState = conversation && readers.workingStates
      ? await readers.workingStates.getWorkingState(principal, conversation.conversationId) : undefined;
    const workingState = savedWorkingState && (!tripId || savedWorkingState.target.tripId === undefined ||
      savedWorkingState.target.tripId === tripId && (savedWorkingState.target.tripRevision === undefined || savedWorkingState.target.tripRevision === trip?.revision))
      ? savedWorkingState : undefined;
    // An itinerary edit invalidates old candidate references, but not conditions
    // accepted in this turn. Recompile those against the freshly authorized Trip.
    const intentWorkingState = workingState ?? (before !== undefined && savedWorkingState?.sourceUserSequence === before &&
      savedWorkingState.target.tripId === tripId ? savedWorkingState : undefined);
    const taskContext = conversationId || trip ? deriveAgentTaskContext({ conversationId, trip: trip ? { id: trip.id, revision: trip.revision,
      lifecycleState: trip.lifecycleState, planningState: trip.planningState } : undefined,
      requestRevision: trip?.revision,
      workingStateRevision: workingState?.revision, previousOutcome: workingState?.lastOutcome?.outcome }) : undefined;
    const turnReceipts = before !== undefined && intentWorkingState?.sourceUserSequence === before
      ? intentWorkingState.semantic?.receipts.filter(({ mutationId }) => mutationId.startsWith(`condition:${intentWorkingState.sourceTurnId}:`)) ?? [] : [];
    const receiptCandidate = turnReceipts.length ? summarizeConditionReceipts(turnReceipts)
      : before !== undefined && intentWorkingState?.sourceUserSequence === before ? intentWorkingState.semantic?.receipts.at(-1) : undefined;
    const currentIntentReceipt = receiptCandidate?.intentRevision === intentWorkingState?.semantic?.overlay.intentRevision
      ? receiptCandidate : undefined;
    const acceptedIntentOperations = currentIntentReceipt?.operations.filter(({ status }) => status === "accepted") ?? [];
    const taskContextWithIntent = taskContext && currentIntentReceipt && acceptedIntentOperations.length ? { ...taskContext,
      currentIntentChange: { intentRevision: currentIntentReceipt.intentRevision, speechAct: currentIntentReceipt.speechAct,
        operations: acceptedIntentOperations.map(({ action, target, frame }) => ({ action, target, frame })) },
    } : taskContext;
    const effectiveIntent = intentWorkingState?.semantic || trip?.request || profile?.profile ? compileEffectiveIntent({
      ...(trip?.request ? { baseRequest: trip.request, baseSource: "trip" as const } : {}),
      ...(taskContext?.requestRevision === undefined ? {} : { baseRevision: taskContext.requestRevision }),
      ...(profile?.profile ? { profile: profile.profile, profileRevision: profile.revision } : {}),
      overlay: intentWorkingState?.semantic?.overlay ?? { version: 1, intentRevision: 0, facts: [], tombstones: [], appliedMutationIds: [] },
    }) : undefined;
    const effectiveProfile = effectiveIntent ? effectiveProfileContext(effectiveIntent) : undefined;
    if (effectiveIntent) options.onEffectiveIntent?.({ effectiveIntent: structuredClone(effectiveIntent),
      ...(currentIntentReceipt ? { currentReceipt: structuredClone(currentIntentReceipt) } : {}) });
    const focusedItem = itemId ? trip?.items.find((item) => item.id === itemId) : undefined;
    return {
      ...(taskContextWithIntent ? { taskContext: taskContextWithIntent } : {}),
      ...(effectiveIntent ? { effectiveIntent } : {}),
      ...(workingState ? { workingState, previousAssistantTurn: workingState.lastOutcome?.outcome } : {}),
      ...(history ? { conversation: history } : {}),
      ...(effectiveProfile ? { travelProfile: effectiveProfile } : {}),
      ...(snapshot.trip ? { currentTrip: snapshot.trip } : {}),
      ...(focusedItem || calendarDate ? { featureContext: {
        ...(focusedItem ? { uiFocus: { itemId: focusedItem.id, item: selectedTripItemSnapshot(focusedItem, trip) } } : {}),
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

async function recentConversation(readers: ServerStateContextReaders["conversations"], principal: TrustedPrincipal, conversation: Conversation, before?: number, onMessages?: (messages: import("../../contracts/server-state.js").ConversationMessage[]) => void) {
  const end = Math.min(conversation.messageCount, before === undefined ? conversation.messageCount : before - 1);
  const start = Math.max(0, end - serverStateContextLimits.historyMessages);
  let last = start;
  const publicMessages: import("../../contracts/server-state.js").ConversationMessage[] = [];
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
      publicMessages.push(structuredClone(message));
      messages.push({ role: message.role, text: message.text }); last = message.sequence;
    }
  }
  // Metadata/reference and history must belong to one conversation revision, including an empty history.
  const latest = await readers.get(principal, conversation.conversationId);
  if (latest.revision !== conversation.revision) throw new StateError("conflict");
  onMessages?.(publicMessages);
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
