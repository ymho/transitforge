import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createTripConsultationNavigation } from "./trip-consultation-navigation";
import type { ConversationSession } from "../../domain/conversation-session";
const trip = (id: string) => createTrip(id, "同じ名前", "2026-09-19T00:00:00Z");
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
function fixture() {
  let current = { conversationId: "old", tripId: "old" }, account = 1;
  const existing = { id: "conversation-b", tripId: b } as ConversationSession;
  const ports = { getTrip: vi.fn(async (id: string) => trip(id)), findConversation: vi.fn(async (id: string) => id === b ? existing : undefined),
    createConversation: vi.fn(async (value: ReturnType<typeof trip>) => ({ id: `conversation-${value.id}`, tripId: value.id }) as ConversationSession),
    activate: vi.fn(async (id: string) => { current = { conversationId: id, tripId: id === existing.id ? b : a }; }),
    refresh: vi.fn(async () => {}), current: () => current, show: vi.fn(), sessionVersion: () => account };
  return { ports, navigation: createTripConsultationNavigation(ports), changeAccount: () => { account++; } };
}
it("opens the explicitly selected Trip and reuses its conversation regardless of identical titles", async () => {
  const f = fixture(); await f.navigation.open(b, "chat");
  expect(f.ports.activate).toHaveBeenCalledWith("conversation-b"); expect(f.ports.createConversation).not.toHaveBeenCalled(); expect(f.ports.show).toHaveBeenCalledWith("chat");
});
it("discards A after B is selected while A's fetch is pending", async () => {
  const f = fixture(); let resolve!: (v: ReturnType<typeof trip>) => void;
  f.ports.getTrip.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const pending = f.navigation.open(a, "chat"); await f.navigation.open(b, "trip"); resolve(trip(a)); await pending;
  expect(f.ports.activate).toHaveBeenCalledTimes(1); expect(f.ports.show).toHaveBeenCalledExactlyOnceWith("trip");
});
it("does not activate a delayed created conversation after cancellation or account switch", async () => {
  for (const cancel of [true, false]) {
    const f = fixture(); let resolve!: (v: ConversationSession) => void;
    f.ports.createConversation.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = f.navigation.open(a, "chat"); await vi.waitFor(() => expect(f.ports.createConversation).toHaveBeenCalled());
    if (cancel) f.navigation.cancel(); else f.changeAccount();
    resolve({ id: "late", tripId: a } as ConversationSession); await pending;
    expect(f.ports.activate).not.toHaveBeenCalled(); expect(f.ports.show).not.toHaveBeenCalled();
  }
});
it("missing or archived Trip cannot reuse a stale conversation", async () => {
  const f = fixture(); f.ports.getTrip.mockResolvedValueOnce(undefined as never);
  await expect(f.navigation.open(a, "chat")).rejects.toThrow("unavailable"); expect(f.ports.activate).not.toHaveBeenCalled();
});
