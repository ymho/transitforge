import type { Trip } from "@raiquora/trip/trip";
import type { ConversationSession } from "../../domain/conversation-session";

/** Latest explicit navigation wins, including account changes and new conversations. */
export function createTripConsultationNavigation(ports: {
  getTrip(id: string): Promise<Trip | undefined>;
  findConversation(tripId: string): Promise<ConversationSession | undefined>;
  createConversation(trip: Trip): Promise<ConversationSession>;
  activate(id: string): Promise<void>;
  refresh(): Promise<void>;
  current(): { conversationId: string; tripId?: string };
  show(view: "trip" | "chat"): void;
  sessionVersion(): number | undefined;
}) {
  let generation = 0;
  return {
    cancel() { return ++generation; },
    version() { return generation; },
    async open(tripId: string, view: "trip" | "chat") {
      const request = ++generation, account = ports.sessionVersion();
      const valid = () => request === generation && account === ports.sessionVersion();
      const trip = await ports.getTrip(tripId);
      if (!valid()) return;
      if (!trip || trip.id !== tripId) throw new Error("Trip unavailable");
      let session = await ports.findConversation(tripId);
      if (!valid()) return;
      session ??= await ports.createConversation(trip);
      if (!valid()) return;
      if (session.tripId !== tripId) throw new Error("Conversation reference changed");
      await ports.activate(session.id);
      if (!valid() || ports.current().conversationId !== session.id) return;
      await ports.refresh();
      if (!valid() || ports.current().conversationId !== session.id) return;
      if (ports.current().tripId !== tripId) throw new Error("Trip unavailable");
      ports.show(view);
    },
  };
}
