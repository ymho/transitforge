import { describe, expect, it, vi } from "vitest";
import { createTrip, applyTripProposal, TripRevisionConflict, type Trip } from "@raiquora/trip/trip";
import { createTripWorkspaceController } from "./trip-workspace-controller";
import { createServerTripWorkspaceSource, createReferencedTripSource } from "./server-trip-workspace-source";
import { createConversationSession } from "../../domain/conversation-session";
import { LocalConversationSessionRepository } from "../../adapters/browser/conversation-session-repository";
import type { TripMutationRequest } from "./server-trip-client";

const trip = createTrip("11111111-1111-4111-8111-111111111111", "Trip", "2026-09-13T01:00:00Z");
describe("server source read view", () => {
  it("restores a durable pending gate on reload and does not reopen it from stale chat metadata", () => {
    const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
    const repository = new LocalConversationSessionRepository(storage), session = createConversationSession();
    repository.save(session); repository.save({ ...session, tripSourceState: "migration-pending" });
    repository.save({ ...session, title: "遅れて届いた要約" });
    const restored = new LocalConversationSessionRepository(storage).active()!;
    expect(restored.tripSourceState).toBe("migration-pending");
    const get = vi.fn(), source = createReferencedTripSource(restored, { get })!;
    const controller = createTripWorkspaceController(restored.id); controller.attach(restored.id, source);
    expect(controller.blocksLegacy()).toBe(true); expect(controller.current()).toBeUndefined();
    expect(controller.canConfirm()).toBe(false); expect(get).not.toHaveBeenCalled();
  });
  it("ignores stale requests and does not expose a mutable local copy", async () => {
    let finish!: (value: Trip) => void;
    const get = vi.fn().mockReturnValueOnce(new Promise<Trip>((resolve) => { finish = resolve; })).mockResolvedValueOnce({ ...trip, title: "new", revision: 2 });
    const source = createServerTripWorkspaceSource(trip.id, { get });
    const first = source.refresh(); await source.refresh(); finish(trip); await first;
    expect(source.getCurrentTrip()?.revision).toBe(2);
    Object.assign(source.getCurrentTrip()!, { title: "fake" });
    expect(source.getCurrentTrip()?.title).toBe("new"); expect(source.confirmProposal).toBeUndefined();
  });
  it("drops previous content on wrong/missing/invalid responses without legacy fallback", async () => {
    const get = vi.fn().mockResolvedValueOnce(trip).mockResolvedValueOnce({ ...trip, id: "wrong" }).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ...trip, candidates: [] });
    const source = createServerTripWorkspaceSource(trip.id, { get }), controller = createTripWorkspaceController("s");
    controller.attach("s", source); await source.refresh(); expect(controller.current()).toEqual(trip);
    for (let i = 0; i < 3; i++) {
      await source.refresh(); expect(controller.loadState()).toBe("unavailable"); expect(controller.current()).toBeUndefined(); expect(controller.blocksLegacy()).toBe(true);
    }
    controller.activateSession("legacy"); expect(controller.blocksLegacy()).toBe(false);
    controller.activateSession("s"); expect(controller.blocksLegacy()).toBe(true);
  });
});

function writable() {
  let server = structuredClone(trip);
  const get = vi.fn(async () => structuredClone(server));
  const receipts = new Map<string, Trip>();
  const mutate = vi.fn(async (m: TripMutationRequest) => {
    const old = receipts.get(m.mutationId); if (old) return old;
    server = { ...applyTripProposal(server, m.proposal), revision: server.revision + 1 };
    receipts.set(m.mutationId, structuredClone(server)); return structuredClone(server);
  });
  const newMutationId = vi.fn(() => "22222222-2222-4222-8222-222222222222"), validateConfirmation = vi.fn(async () => {});
  const source = createServerTripWorkspaceSource(trip.id, { get }, { mutate, newMutationId, validateConfirmation });
  const controller = createTripWorkspaceController("session"); controller.attach("session", source);
  return { source, controller, get, mutate, newMutationId, validateConfirmation, set: (value: Trip) => { server = value; },
    propose() { controller.propose("散策", [{ type: "add", item: { id: "walk", title: "散策", type: "activity", category: "free-time", schedule: { type: "unscheduled" } } }]); } };
}
describe("authenticated server confirmation host", () => {
  it("validates current revision and host evidence before writing, then GETs latest", async () => {
    const f = writable(); await f.source.refresh(); f.propose();
    expect(f.controller.proposal()?.baseRevision).toBe(0); expect(f.mutate).not.toHaveBeenCalled();
    await f.controller.confirm();
    expect(f.validateConfirmation).toHaveBeenCalledOnce(); expect(f.mutate).toHaveBeenCalledOnce();
    expect(f.controller.current()?.revision).toBe(1); expect(f.controller.proposal()).toBeUndefined();
    expect(f.get).toHaveBeenCalledTimes(3); expect(f.controller.blocksLegacy()).toBe(true);
  });
  it("stale confirmation refreshes latest, discards old proposal and never rebases", async () => {
    const f = writable(); await f.source.refresh(); f.propose();
    f.set({ ...trip, revision: 1, title: "別の編集" });
    await expect(f.controller.confirm()).rejects.toBeInstanceOf(TripRevisionConflict);
    expect(f.mutate).not.toHaveBeenCalled(); expect(f.controller.proposal()).toBeUndefined();
    expect(f.controller.current()?.title).toBe("別の編集"); expect(f.controller.blocksLegacy()).toBe(true);
  });
  it("CAS race after preflight refreshes and invalidates proposal", async () => {
    const f = writable(); await f.source.refresh(); f.propose();
    f.mutate.mockImplementationOnce(async () => { f.set({ ...trip, revision: 1 }); throw new TripRevisionConflict(); });
    await expect(f.controller.confirm()).rejects.toBeInstanceOf(TripRevisionConflict);
    expect(f.controller.current()?.revision).toBe(1); expect(f.controller.proposal()).toBeUndefined();
  });
  it("lost response retry reuses the exact mutation, shows current Trip and never doubles add", async () => {
    const f = writable(); await f.source.refresh(); f.propose();
    const real = f.mutate.getMockImplementation()!;
    f.mutate.mockImplementationOnce(async (m) => { await real(m); throw new Error("response lost"); });
    await expect(f.controller.confirm()).rejects.toThrow("response lost");
    expect(f.controller.loadState()).toBe("unavailable"); expect(f.controller.current()).toBeUndefined();
    expect(f.controller.blocksLegacy()).toBe(true);
    await f.source.retry!();
    expect(f.newMutationId).toHaveBeenCalledOnce(); expect(f.mutate.mock.calls[0]).toEqual(f.mutate.mock.calls[1]);
    expect(f.controller.current()?.items).toHaveLength(1); expect(f.controller.current()?.revision).toBe(1);
    expect(f.controller.proposal()).toBeUndefined();
  });
  it("failed conflict refresh remains gated and latest GET can be retried", async () => {
    const f = writable(); await f.source.refresh(); f.propose();
    f.mutate.mockImplementationOnce(async () => { f.get.mockRejectedValueOnce(new Error("offline")); f.set({ ...trip, revision: 1 }); throw new TripRevisionConflict(); });
    await expect(f.controller.confirm()).rejects.toBeInstanceOf(TripRevisionConflict);
    expect(f.controller.loadState()).toBe("unavailable"); expect(f.controller.proposal()).toBeUndefined();
    await f.source.retry!(); expect(f.controller.current()?.revision).toBe(1); expect(f.mutate).toHaveBeenCalledOnce();
  });
});
