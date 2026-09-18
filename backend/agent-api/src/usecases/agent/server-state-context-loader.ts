import { createAgentContextSnapshot, selectedTripItemSnapshot } from "@raiquora/agent/agent-context-snapshot";
import { boundAgentConversationContext, type AgentConversationContext, type AgentRuntimeContextInput } from "@raiquora/agent/agent-decision-context";
import type { TrustedPrincipal } from "../../contracts/trusted-principal.js";
import { StateError, requireStatePrincipal, stateId, type Conversation } from "../../contracts/server-state.js";
import type { TripRepository } from "../../ports/trip-repository.js";
import type { ConversationApplication } from "../conversation-application.js";
import type { ProfileApplication } from "../profile-application.js";

export const serverStateContextLimits = { historyMessages: 12, conversationJsonCharacters: 12_000 } as const;
export interface ServerStateContextReferences {
  principal: TrustedPrincipal;
  conversationId?: string;
  tripId?: string;
  uiContext?: { itemId?: string };
}
export interface ServerStateContextReaders {
  conversations: Pick<ConversationApplication, "get" | "history">;
  profiles: Pick<ProfileApplication, "get">;
  /** Owner-scoped Trip V2 read, not a global ID lookup or a request-selected owner. */
  trips: Pick<TripRepository, "get">;
}

/** Read-only and per-turn. No cache, message append, transport or model dependencies. */
export function createServerStateContextLoader(readers: ServerStateContextReaders, options: { historyBeforeSequence?: number } = {}) {
  const before = options.historyBeforeSequence;
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new StateError("invalid-input");
  return async (input: ServerStateContextReferences): Promise<AgentRuntimeContextInput> => {
    requireStatePrincipal(input.principal);
    if (input.conversationId !== undefined) stateId(input.conversationId);
    if (input.tripId !== undefined) stateId(input.tripId);
    const itemId = input.uiContext?.itemId;
    if (itemId !== undefined && (typeof itemId !== "string" || !itemId.trim() || itemId.length > 200 || /[\u0000-\u001f\u007f]/u.test(itemId))) throw new StateError("invalid-input");
    // Snapshot only allowlisted references before awaiting. Caller mutations cannot switch account/Trip.
    const principal = structuredClone(input.principal), conversationId = input.conversationId, explicitTripId = input.tripId;
    const conversation = conversationId ? await readers.conversations.get(principal, conversationId) : undefined;
    if (conversation?.tripId && explicitTripId && conversation.tripId !== explicitTripId) throw new StateError("invalid-input");
    const tripId = conversation?.tripId ?? explicitTripId;
    const trip = tripId ? await readers.trips.get(principal, tripId) : undefined;
    if (tripId && !trip) throw new StateError("not-found");
    const profile = await readers.profiles.get(principal);
    const history = conversation ? await recentConversation(readers.conversations, principal, conversation, before) : undefined;
    const snapshot = createAgentContextSnapshot(profile?.profile, trip);
    const focusedItem = itemId ? trip?.items.find((item) => item.id === itemId) : undefined;
    return {
      ...(history ? { conversation: history } : {}),
      ...(snapshot.profile ? { travelProfile: snapshot.profile } : {}),
      ...(snapshot.trip ? { currentTrip: snapshot.trip } : {}),
      ...(focusedItem ? { featureContext: { uiFocus: { itemId: focusedItem.id, item: selectedTripItemSnapshot(focusedItem) } } } : {}),
    };
  };
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
