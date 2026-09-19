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
});
