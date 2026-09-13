import type { ConversationSessionRepository } from "../concierge/conversation-session-repository";
import type { ServerTripClient } from "./server-trip-client";

/** Successful server reference operation precedes the local UI reference; no Trip mutation. */
export async function setConversationTripReference(repository: ConversationSessionRepository, client: ServerTripClient,
  sessionId: string, tripId?: string): Promise<void> {
  if (!repository.list().some((session) => session.id === sessionId)) throw new Error("Conversation missing");
  if (tripId === undefined) await client.detach(sessionId);
  else await client.attach(sessionId, tripId);
  const session = repository.list().find((value) => value.id === sessionId);
  if (!session) return; // Deleted while awaiting server; never resurrect a conversation.
  const { tripId: previous, ...rest } = session;
  repository.save({ ...rest, tripSourceState: "server-v2", ...(tripId ? { tripId } : {}) });
}
