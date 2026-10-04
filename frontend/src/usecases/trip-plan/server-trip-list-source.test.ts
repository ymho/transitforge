import { describe, expect, it, vi } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { createServerTripListSource } from "./server-trip-list-source";

const trip = (id: string) => createTrip(id, id, "2026-09-18T00:00:00Z");
describe("server Trip list source", () => {
  it("collects every existing cursor page before classifying Home data", async () => {
    const a = trip("11111111-1111-4111-8111-111111111111"), b = trip("22222222-2222-4222-8222-222222222222"), c = trip("33333333-3333-4333-8333-333333333333");
    const list = vi.fn().mockResolvedValueOnce({ trips: [a, b], nextAfterTripId: b.id }).mockResolvedValueOnce({ trips: [c] });
    const source = createServerTripListSource({ list }, () => true);
    await source.refresh();
    expect(source.getState()).toBe("available"); expect(source.getTrips()).toEqual([a, b, c]);
    expect(list).toHaveBeenNthCalledWith(1, { limit: 50 }); expect(list).toHaveBeenNthCalledWith(2, { limit: 50, afterTripId: b.id });
  });
  it("does not turn a partial page failure into an empty list", async () => {
    const list = vi.fn().mockResolvedValueOnce({ trips: [trip("11111111-1111-4111-8111-111111111111")], nextAfterTripId: "22222222-2222-4222-8222-222222222222" }).mockRejectedValueOnce(new Error("offline"));
    const source = createServerTripListSource({ list }, () => true);
    await source.refresh();
    expect(source.getState()).toBe("unavailable"); expect(source.getTrips()).toEqual([]);
  });
  it("keeps signed-out reads silent even inside a synchronous subscriber", () => {
    const list = vi.fn(), source = createServerTripListSource({ list }, () => false);
    const listener = vi.fn(() => { source.getState(); source.getTrips(); });
    source.subscribe(listener);
    for (let i = 0; i < 10; i++) {
      expect(source.getState()).toBe("unauthenticated"); expect(source.getTrips()).toEqual([]);
    }
    expect(listener).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });
  it("notifies once for authentication-only and version-only transitions before subscriber rereads", async () => {
    let authenticated = false, version = 0;
    const a = trip("11111111-1111-4111-8111-111111111111");
    const source = createServerTripListSource({ list: vi.fn().mockResolvedValue({ trips: [a] }), sessionVersion: () => version }, () => authenticated);
    const listener = vi.fn(() => { source.getState(); source.getTrips(); }); source.subscribe(listener);
    authenticated = true;
    expect(source.getState()).toBe("loading"); expect(listener).toHaveBeenCalledTimes(1);
    await source.refresh(); expect(source.getTrips()).toEqual([a]); listener.mockClear();
    authenticated = false;
    expect(source.getTrips()).toEqual([]); expect(source.getState()).toBe("unauthenticated"); expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear(); version++;
    expect(source.getState()).toBe("unauthenticated"); expect(listener).toHaveBeenCalledTimes(1);
    source.getTrips(); source.getState(); expect(listener).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("discards late responses and failures after account switches (failure=%s)", async failure => {
    let version = 0, change = () => {};
    let resolve!: (value: { trips: ReturnType<typeof trip>[] }) => void, reject!: (error: Error) => void;
    const list = vi.fn().mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; })).mockResolvedValue({ trips: [] });
    const source = createServerTripListSource({ list, sessionVersion: () => version,
      subscribeSessionChange: listener => { change = listener; return () => {}; } }, () => true);
    const pending = source.refresh(); version++; change(); await source.refresh();
    if (failure) reject(new Error("old account offline")); else resolve({ trips: [trip("11111111-1111-4111-8111-111111111111")] });
    await pending; expect(source.getState()).toBe("available"); expect(source.getTrips()).toEqual([]);
  });

});
