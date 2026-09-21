import { createTrip, validateTrip, type Trip } from "@raiquora/trip/trip";
import { parseConsultationRequest } from "@raiquora/trip/consultation-request";
import type { TripRequest } from "@raiquora/trip/trip-request";
import type { ServerTripClient } from "./server-trip-client";
import type { ServerConversationClient } from "../personal-state/server-conversation-client";

/** Explicit handoff: create/read back first, then CAS the authoritative Conversation link and clear its draft. */
export async function createConversationDraftTrip(input: { conversationId: string; tripId: string; now: string; request: TripRequest;
  client: Pick<ServerTripClient, "create" | "get" | "sessionVersion">;
  conversations: Pick<ServerConversationClient, "get" | "update"> }): Promise<Trip> {
  const { conversationId, tripId, now } = input, request = parseConsultationRequest(input.request);
  const epoch = input.client.sessionVersion?.();
  const current = () => { if (epoch !== input.client.sessionVersion?.()) throw new Error("Account changed"); };
  const before = await input.conversations.get(conversationId); current();
  if (!before || before.tripId && before.tripId !== tripId) throw new Error("Conversation reference changed");
  if (before.tripId === tripId) {
    const saved = await input.client.get(tripId); current();
    if (!saved || saved.id !== tripId) throw new Error("Trip read-back unavailable"); validateTrip(saved); return saved;
  }
  const expected = JSON.stringify(request);
  if (JSON.stringify(before.draftRequest ?? { constraints: [], assumptions: [] }) !== expected) throw new Error("相談の条件が変わりました。保存内容を確認してください。");
  const trip = await input.client.create(createTrip(tripId, "新しい旅程", now, [], request)); current();
  if (trip.id !== tripId) throw new Error("Wrong Trip response");
  const verified = await input.client.get(tripId); current();
  if (!verified || verified.id !== tripId || JSON.stringify(verified.request) !== expected) throw new Error("Trip conditions read-back unavailable");
  validateTrip(verified);
  const latest = await input.conversations.get(conversationId); current();
  if (!latest || latest.tripId && latest.tripId !== tripId) throw new Error("Conversation reference changed");
  if (!latest.tripId) {
    if (JSON.stringify(latest.draftRequest ?? { constraints: [], assumptions: [] }) !== expected) throw new Error("相談の条件が更新されたため、引き継ぎを中止しました。");
    await input.conversations.update(conversationId, latest.revision, { title: latest.title, scope: "trip", summary: latest.summary,
      resolvedTopics: latest.resolvedTopics, pendingTopics: latest.pendingTopics, tripId }); current();
  }
  const linked = await input.conversations.get(conversationId); current();
  if (linked?.tripId !== tripId || linked.draftRequest !== undefined) throw new Error("Conversation reference unavailable");
  return verified;
}
