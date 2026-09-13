import { describe, expect, it, vi } from "vitest";
import { createConversationSession, parseConversationSession } from "../../domain/conversation-session";
import { setConversationTripReference } from "./conversation-trip-reference";
import type { ConversationSessionRepository } from "../concierge/conversation-session-repository";
const tripId = "11111111-1111-4111-8111-111111111111";
describe("conversation Trip references", () => {
  it("supports multiple sessions, round-trips optional ref and detach never mutates Trip", async () => {
    let sessions = [createConversationSession(), createConversationSession()];
    const repository = { list: () => structuredClone(sessions), save: vi.fn((session) => { sessions = sessions.map((s) => s.id === session.id ? session : s); return session; }) } as unknown as ConversationSessionRepository;
    const client = { attach: vi.fn(async () => {}), detach: vi.fn(async () => {}), get: vi.fn(), create: vi.fn() };
    for (const session of sessions) await setConversationTripReference(repository, client, session.id, tripId);
    expect(sessions.map((s) => parseConversationSession(s)?.tripId)).toEqual([tripId, tripId]);
    await setConversationTripReference(repository, client, sessions[0]!.id);
    expect(sessions[0]!.tripId).toBeUndefined(); expect(sessions[0]!.tripSourceState).toBe("server-v2");
    expect(sessions[1]!.tripId).toBe(tripId);
    expect(client.create).not.toHaveBeenCalled(); expect(client.get).not.toHaveBeenCalled();
    expect(parseConversationSession({ ...sessions[0], tripId: "bad" })).toBeUndefined();
  });
  it("does not change local reference on failed attach", async () => {
    const session = createConversationSession(), save = vi.fn();
    const repository = { list: () => [session], save } as unknown as ConversationSessionRepository;
    await expect(setConversationTripReference(repository, { attach: async () => { throw new Error(); }, detach: vi.fn(), get: vi.fn(), create: vi.fn() }, session.id, tripId)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
