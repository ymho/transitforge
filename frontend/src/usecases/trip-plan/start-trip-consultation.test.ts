import { expect, it, vi } from "vitest";
import { startTripConsultation } from "./start-trip-consultation";

function fixture() {
  let current = true, active = { conversationId: "none", tripId: undefined as string | undefined };
  const tripId = "75300000-0000-4000-8000-000000000001";
  const createTrip = vi.fn(async (trip) => structuredClone(trip));
  const archiveTrip = vi.fn(async () => {});
  const createConversation = vi.fn(async (metadata) => ({ id: "conversation", ...metadata, summary: "", resolvedTopics: [], pendingTopics: [],
    createdAt: "2026-09-27T12:00:00.000Z", updatedAt: "2026-09-27T12:00:00.000Z" }));
  const activate = vi.fn(async (id: string) => { active = { conversationId: id, tripId }; });
  const submit = vi.fn();
  return { tripId, createTrip, archiveTrip, createConversation, activate, submit, current: () => active,
    isCurrent: () => current, cancel: () => { current = false; } };
}
const run = (f: ReturnType<typeof fixture>, prompt = "出雲大社に行きたい") => startTripConsultation({
  prompt, tripId: f.tripId, now: "2026-09-27T12:00:00.000Z", isCurrent: f.isCurrent, createTrip: f.createTrip,
  archiveTrip: f.archiveTrip, createConversation: f.createConversation, activate: f.activate, current: f.current, submit: f.submit,
});
it("creates an inspiration Trip before its history stream and sends the first prompt only after both are active", async () => {
  const f = fixture();
  const result = await run(f);
  expect(result.trip).toMatchObject({ id: f.tripId, planningState: "inspiration", items: [], request: { constraints: [], assumptions: [] } });
  expect(f.createConversation).toHaveBeenCalledWith(expect.objectContaining({ scope: "trip", tripId: f.tripId }));
  expect(f.submit).toHaveBeenCalledExactlyOnceWith("出雲大社に行きたい");
  expect(f.createTrip.mock.invocationCallOrder[0]).toBeLessThan(f.createConversation.mock.invocationCallOrder[0]!);
  expect(f.createConversation.mock.invocationCallOrder[0]).toBeLessThan(f.activate.mock.invocationCallOrder[0]!);
  expect(f.activate.mock.invocationCallOrder[0]).toBeLessThan(f.submit.mock.invocationCallOrder[0]!);
});
it("never creates a standalone Conversation when Trip creation fails", async () => {
  const f = fixture(); f.createTrip.mockRejectedValueOnce(new Error("trip unavailable"));
  await expect(run(f)).rejects.toThrow("trip unavailable");
  expect(f.createConversation).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});
it("best-effort archives a newly created Trip when its Conversation cannot be created", async () => {
  const f = fixture(); f.createConversation.mockRejectedValueOnce(new Error("conversation unavailable"));
  await expect(run(f)).rejects.toThrow("conversation unavailable");
  expect(f.archiveTrip).toHaveBeenCalledExactlyOnceWith(f.tripId); expect(f.submit).not.toHaveBeenCalled();
});
it("does not send after navigation/account changes during creation", async () => {
  const f = fixture(); f.createConversation.mockImplementationOnce(async metadata => { f.cancel(); return { id: "conversation", ...metadata, summary: "", resolvedTopics: [], pendingTopics: [], createdAt: "2026-09-27T12:00:00.000Z", updatedAt: "2026-09-27T12:00:00.000Z" }; });
  await expect(run(f)).rejects.toThrow("navigation changed"); expect(f.activate).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
});
it("requires the active Conversation and Trip to match before the model call", async () => {
  const f = fixture(); f.activate.mockImplementationOnce(async () => {});
  await expect(run(f)).rejects.toThrow("activation changed"); expect(f.submit).not.toHaveBeenCalled();
});
