import { describe, expect, it, vi } from "vitest";
import { createTrip, type Trip } from "@raiquora/trip/trip";
import { createTripWorkspaceController } from "./trip-workspace-controller";
import { createServerTripWorkspaceSource } from "./server-trip-workspace-source";

const trip = createTrip("11111111-1111-4111-8111-111111111111", "Trip", "2026-09-13T01:00:00Z");
describe("server source read view", () => {
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
