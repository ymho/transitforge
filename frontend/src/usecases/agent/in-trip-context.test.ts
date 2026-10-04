import { describe, expect, it, vi } from "vitest";
import { inTripFixture } from "../../../../modules/trip/domain/in-trip-context.fixture";
import { loadInTripContext } from "./in-trip-context";
describe("in-trip Agent boundary", () => {
  it("loads only in_trip, validates revision and keeps reader failure explicit", async () => {
    const f = inTripFixture(), read = vi.fn(async () => f.snapshot);
    expect(await loadInTripContext({ ...f.trip, lifecycleState: "pre_trip" }, new Date(f.now.at), { read })).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    expect(await loadInTripContext(f.trip, new Date(f.now.at), { read })).toEqual(f.snapshot);
    read.mockRejectedValue(new Error("PRIVATE"));
    expect((await loadInTripContext(f.trip, new Date(f.now.at), { read }))!.impacts.status).toBe("unavailable");
    read.mockResolvedValue({ ...f.snapshot, trip: { ...f.snapshot.trip, revision: 99 } });
    await expect(loadInTripContext(f.trip, new Date(f.now.at), { read })).rejects.toThrow("旅程が更新");
  });

});
