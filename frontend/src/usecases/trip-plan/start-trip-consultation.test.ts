import { expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { startTripConsultation } from "./start-trip-consultation";
const tripId = "75300000-0000-4000-8000-000000000001";
function fixture() {
  let valid = true, active = { conversationId: "none", tripId: undefined as string | undefined };
  const start = vi.fn(async (input: { tripId: string; title: string }) => ({ trip: createTrip(input.tripId, input.title, "2026-09-27T12:00:00Z"), conversationId: input.tripId }));
  const activate = vi.fn(async (id: string, target: string) => { active = { conversationId: id, tripId: target }; });
  return { prompt: "出雲大社に行きたい", tripId, start, activate, current: () => active,
    isCurrent: () => valid, cancel: () => { valid = false; }, submit: vi.fn() };
}
it("activates both server-created resources before sending the original prompt once", async () => {
  const f = fixture(), result = await startTripConsultation(f);
  expect(result.trip).toMatchObject({ id: tripId, planningState: "inspiration", items: [] });
  expect(f.start).toHaveBeenCalledExactlyOnceWith({ tripId, title: f.prompt });
  expect(f.activate).toHaveBeenCalledExactlyOnceWith(tripId, tripId);
  expect(f.submit).toHaveBeenCalledExactlyOnceWith(f.prompt);
  expect(f.start.mock.invocationCallOrder[0]).toBeLessThan(f.activate.mock.invocationCallOrder[0]!);
  expect(f.activate.mock.invocationCallOrder[0]).toBeLessThan(f.submit.mock.invocationCallOrder[0]!);
});
it("reuses the same start identity after an uncertain response; no cleanup or alternate write capability exists", async () => {
  const f = fixture(); f.start.mockRejectedValueOnce(new Error("response lost"));
  await expect(startTripConsultation(f)).rejects.toThrow("response lost");
  expect(f.activate).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled();
  await startTripConsultation(f);
  expect(f.start.mock.calls[0]).toEqual(f.start.mock.calls[1]);
  expect(f.submit).toHaveBeenCalledOnce();
});
it("cannot send after changing account or page while start or activation is pending", async () => {
  for (const step of ["start", "activate"] as const) {
    const f = fixture();
    if (step === "start") f.start.mockImplementationOnce(async input => { f.cancel(); return { trip: createTrip(tripId, input.title, "2026-09-27T12:00:00Z"), conversationId: tripId }; });
    else f.activate.mockImplementationOnce(async () => { f.cancel(); });
    await expect(startTripConsultation(f)).rejects.toThrow("navigation changed");
    expect(f.submit).not.toHaveBeenCalled();
  }
});
it("requires read-back of the actual active Trip, not just its Conversation metadata", async () => {
  const f = fixture(); f.activate.mockImplementationOnce(async () => {});
  await expect(startTripConsultation(f)).rejects.toThrow("activation changed"); expect(f.submit).not.toHaveBeenCalled();
});
it("rejects another Trip or history identity without selecting it", async () => {
  const f = fixture(); f.start.mockResolvedValueOnce({ trip: createTrip(tripId, "旅", "2026-09-27T12:00:00Z"), conversationId: "75300000-0000-4000-8000-000000000002" });
  await expect(startTripConsultation(f)).rejects.toThrow("Wrong Trip"); expect(f.activate).not.toHaveBeenCalled();
});
