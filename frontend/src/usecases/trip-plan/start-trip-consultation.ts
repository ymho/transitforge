import { createTrip, validateTrip, type Trip } from "@raiquora/trip/trip";
import type { ConversationSession } from "../../domain/conversation-session";

/** Starts a new travel consultation with Trip as the authority from the first user message.
 * The Trip is created before any model call. Conversation is only a history stream linked
 * to that Trip; no conversation draft becomes a second TripRequest authority. */
export async function startTripConsultation(input: {
  prompt: string;
  tripId: string;
  now: string;
  isCurrent(): boolean;
  createTrip(trip: Trip): Promise<Trip>;
  archiveTrip(tripId: string): Promise<void>;
  createConversation(metadata: { title: string; scope: "trip"; tripId: string }): Promise<ConversationSession>;
  activate(conversationId: string): Promise<void>;
  current(): { conversationId: string; tripId?: string };
  submit(prompt: string): void;
}): Promise<{ trip: Trip; conversation: ConversationSession }> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Empty consultation");
  const current = () => { if (!input.isCurrent()) throw new Error("Consultation navigation changed"); };
  current();
  const title = consultationTitle(prompt);
  const proposed = createTrip(input.tripId, title, input.now);
  const trip = await input.createTrip(proposed);
  current();
  validateTrip(trip);
  if (trip.id !== input.tripId || trip.revision !== 0) throw new Error("Unexpected Trip creation result");

  let conversation: ConversationSession;
  try {
    conversation = await input.createConversation({ title, scope: "trip", tripId: trip.id });
  } catch (error) {
    // Best effort only. A failed cleanup leaves a valid Trip visible in the Trip list,
    // from which consultation navigation can create its history stream later.
    try { await input.archiveTrip(trip.id); } catch { /* recoverable from Trip list */ }
    throw error;
  }
  current();
  if (conversation.tripId !== trip.id || conversation.scope !== "trip") throw new Error("Conversation is not linked to created Trip");
  await input.activate(conversation.id);
  current();
  const active = input.current();
  if (active.conversationId !== conversation.id || active.tripId !== trip.id) throw new Error("Trip consultation activation changed");
  input.submit(prompt);
  return { trip: structuredClone(trip), conversation: structuredClone(conversation) };
}

function consultationTitle(prompt: string): string {
  const oneLine = prompt.replace(/\s+/gu, " ").trim();
  return (oneLine.length > 40 ? `${oneLine.slice(0, 39)}…` : oneLine) || "検討中の旅";
}
