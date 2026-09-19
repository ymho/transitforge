import { createTrip, type Trip } from "@raiquora/trip/trip";
import type { ServerTripClient } from "./server-trip-client";

/** Explicit draft save: creates first, then links the conversation; it never rolls a saved Trip back. */
export async function createConversationDraftTrip(input: { conversationId: string; tripId: string; now: string;
  client: Pick<ServerTripClient, "create" | "attach">; readBack: (conversationId: string) => Promise<{ tripId?: string } | undefined> }): Promise<Trip> {
  const trip = await input.client.create(createTrip(input.tripId, "新しい旅程", input.now));
  if (trip.id !== input.tripId) throw new Error("Wrong Trip response");
  await input.client.attach(input.conversationId, trip.id);
  const conversation = await input.readBack(input.conversationId);
  if (conversation?.tripId !== trip.id) throw new Error("Conversation reference unavailable");
  return trip;
}
