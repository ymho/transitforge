import { describe, expect, it, vi } from "vitest";
import { watchTrip } from "../../../../modules/trip/domain/trip-watch.fixture.js";
import { hazardInformation } from "../../../../modules/trip/domain/hazard-alert.fixture.js";
import { hazardTravelEvent } from "@raiquora/trip/travel-event-projection";
import { tripImpactId, type TripImpact } from "@raiquora/trip/trip-impact";
import { watchDynamoFixture } from "../adapters/watch-dynamodb.fixture.js";
import { TripWatchApplication, TripWatchWorker } from "./trip-watch-application.js";
import type { TripImpactEvaluator } from "../ports/trip-impact-evaluator.js";

const principal = { subject: "owner-A" }, now = "2026-09-12T08:01:00Z";
function setup() {
  const f = watchDynamoFixture(), trip = watchTrip(); f.seed(trip);
  const scopes = { resolve: async () => [{ itineraryItemId: "rail", subject: { type: "hazard-area" as const, area: "大阪府" } }] };
  const application = new TripWatchApplication(f.repository, f.watches, scopes);
  const evaluate = vi.fn<TripImpactEvaluator["evaluate"]>(async (input) => {
    const impact: Omit<TripImpact, "id"> = { tripId: input.trip.id, tripRevision: input.trip.revision, eventId: input.event.id,
      status: "unknown", severity: "informational", affectedItemIds: input.watches.map((w) => w.itineraryItemId), reasonCodes: ["external_data_unknown"], evaluatedAt: input.evaluatedAt };
    return { ...impact, id: tripImpactId(impact) };
  });
  const facts = vi.fn(async () => []);
  const worker = new TripWatchWorker(f.repository, f.watches, { evaluate }, { facts }, { now: () => new Date(now) });
  return { ...f, trip, application, evaluate, facts, worker, event: hazardTravelEvent({ area: "大阪府" }, hazardInformation(), now) };
}
describe("internal watch worker seam", () => {
  it("looks up owner watches, loads saved Trip and read-only reservation facts, returns revision-bound result", async () => {
    const f = setup(); await f.application.reconcile(principal, f.trip.id);
    const before = structuredClone(f.trip);
    const result = await f.worker.process(principal, f.event);
    expect(result.impacts).toHaveLength(1); expect(result.skipped).toEqual([]);
    expect(f.evaluate).toHaveBeenCalledOnce(); expect(f.facts).toHaveBeenCalledWith(principal, f.trip.id);
    expect(f.evaluate.mock.calls[0]![0].trip).toEqual(before);
    expect(f.evaluate.mock.calls[0]![0].event.fact).toHaveProperty("coverage", "query-limited");
    expect(await f.repository.get(principal, f.trip.id)).toEqual(before);
    expect([...f.records.values()].every((r) => /^(TRIP#|WATCH#|WATCH_STATE#)/.test(r.sk!.S!))).toBe(true);
    expect(result.impacts[0]).not.toHaveProperty("notification");
  });
  it("skips old Watch revision and archived Trip without evaluator calls or silent rebase", async () => {
    const f = setup(); await f.application.reconcile(principal, f.trip.id);
    f.seed({ ...f.trip, revision: 1 });
    expect((await f.worker.process(principal, f.event)).skipped).toEqual([{ tripId: f.trip.id, reason: "watch_stale" }]);
    expect(f.evaluate).not.toHaveBeenCalled();
    await f.repository.archive(principal, f.trip.id);
    expect((await f.worker.process(principal, f.event)).skipped[0]!.reason).toBe("trip_unavailable");
  });
  it("discards Impact when Trip changed during evaluation; evaluator failure cannot mutate Trip", async () => {
    const f = setup(); await f.application.reconcile(principal, f.trip.id);
    const original = f.evaluate.getMockImplementation()!;
    f.evaluate.mockImplementation(async (input) => { const impact = await original(input); f.seed({ ...f.trip, revision: 1 }); return impact; });
    expect(await f.worker.process(principal, f.event)).toEqual({ impacts: [], skipped: [{ tripId: f.trip.id, reason: "trip_changed" }] });
    await f.application.reconcile(principal, f.trip.id);
    f.evaluate.mockRejectedValue(new Error("evaluator unavailable"));
    await expect(f.worker.process(principal, f.event)).rejects.toThrow("evaluator unavailable");
    expect((await f.repository.get(principal, f.trip.id))!.revision).toBe(1);
  });
  it("does not leak another owner's Trip or call a default severity evaluator", async () => {
    const f = setup(); await f.application.reconcile(principal, f.trip.id);
    expect(await f.worker.process({ subject: "owner-B" }, f.event)).toEqual({ impacts: [], skipped: [] });
    expect(f.evaluate).not.toHaveBeenCalled();
    await expect(f.worker.process(undefined as never, f.event)).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("rejects foreign item/revision result and private Reservation payload", async () => {
    const f = setup(); await f.application.reconcile(principal, f.trip.id);
    const original = f.evaluate.getMockImplementation()!;
    f.evaluate.mockImplementation(async (input) => { const value = { ...await original(input), affectedItemIds: ["foreign"] }; return { ...value, id: tripImpactId(value) }; });
    await expect(f.worker.process(principal, f.event)).rejects.toMatchObject({ code: "invalid-input" });
    f.facts.mockResolvedValue([{ bookingReference: "private" }] as never);
    await expect(f.worker.process(principal, f.event)).rejects.toThrow();
  });
});
