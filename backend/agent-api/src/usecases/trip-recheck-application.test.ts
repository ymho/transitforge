import { describe, expect, it, vi } from "vitest";
import { areaInput, areaNow, areaWeatherEvent } from "../../../../modules/trip/domain/area-trip-impact.fixture.js";
import { railImpactDynamoFixture } from "../adapters/rail-impact-dynamodb.fixture.js";
import { recheckDynamoFixture } from "../adapters/recheck-dynamodb.fixture.js";
import { TripRecheckProjection, TripRecheckWorker } from "./trip-recheck-application.js";
import { TripWatchWorker } from "./trip-watch-application.js";
import { TripImpactApplication } from "./trip-impact-application.js";
import { DeterministicTripImpactEvaluator } from "./trip-impact-evaluator.js";
import { RecheckFailure } from "../contracts/trip-recheck.js";
import { TripChangedConsumer } from "./trip-changed-consumer.js";
import { watchTrip } from "../../../../modules/trip/domain/trip-watch.fixture.js";

const owner = { subject: "owner-A" };
async function setup() {
  const f = railImpactDynamoFixture(), queue = recheckDynamoFixture(), { trip, event } = areaInput(); f.seed(trip);
  let now = Date.parse(areaNow);
  const clock = { now: () => new Date(now) }, record = vi.fn();
  const scopes = { resolve: vi.fn(async () => ({ scopes: [{ itineraryItemId: "activity", subject: event.subject as { type: "weather-area"; area: string } }], unresolved: false })) };
  const projection = new TripRecheckProjection(f.repository, f.watches, queue.repository, scopes, clock);
  await projection.reconcile(owner, trip.id);
  const impact = new TripImpactApplication(f.router,
    new TripWatchWorker(f.repository, f.watches, new DeterministicTripImpactEvaluator(), { facts: async () => [] }, clock), f.repository, f.impacts, { record: vi.fn() }, clock);
  const source = { events: vi.fn(async () => [event]) };
  const worker = new TripRecheckWorker(queue.repository, f.repository, f.watches, projection, source, impact, { record }, clock);
  const advanceToDue = () => { now = Math.max(now + 1, Math.min(...[...queue.rows.values()].filter((r) => r.deliveryState?.S === "pending").map((r) => Number(r.dueAt!.N)))); };
  return { ...f, queue, trip, event, projection, source, worker, record, scopes, clock, advanceToDue,
    advance: (ms: number) => { now += ms; }, impactRows: () => [...f.records.values()].filter((r) => r.sk?.S?.startsWith("IMPACT#")) };
}
describe("shared time-originated recheck -> existing Impact pipeline", () => {
  it("rail A to B/removal projects distinct task identities and retains inactive Watch history", async () => {
    const f = railImpactDynamoFixture(), queue = recheckDynamoFixture(), trip = watchTrip(); f.seed(trip);
    const projection = new TripRecheckProjection(f.repository, f.watches, queue.repository, { resolve: async () => ({ scopes: [], unresolved: false }) }, { now: () => new Date(areaNow) });
    await projection.reconcile(owner, trip.id); const before = [...queue.rows.keys()];
    const next = structuredClone(trip), rail = next.items[0]!;
    if (rail.type !== "transport" || rail.detail.mode !== "rail" || rail.detail.status !== "selected") throw new Error();
    // Service replacement is normally validated by adoption. Rename this synthetic verified identity consistently.
    const changed = JSON.parse(JSON.stringify(next).replaceAll('"s1"', '"s3"').replaceAll('"1M"', '"3M"'));
    changed.revision = 1; f.seed(changed); await projection.reconcile(owner, trip.id);
    expect([...queue.rows.keys()].filter((key) => !before.includes(key))).toHaveLength(2);
    expect((await f.watches.read(owner, trip.id)).records.some((r) => !r.active && r.watch.subject.type === "rail-service" && r.watch.subject.serviceUid === "s1")).toBe(true);
    f.seed({ ...changed, revision: 2, items: [] }); await projection.reconcile(owner, trip.id);
    expect((await f.watches.read(owner, trip.id)).records.every((r) => !r.active)).toBe(true);
    // No cascade deletes; every old task still has its original revision and will be skipped on execution.
    expect(queue.rows.size).toBe(4);
  });
  it("partial Watch batch uses existing complete=false recovery before creating tasks", async () => {
    const f = railImpactDynamoFixture(), queue = recheckDynamoFixture(), original = areaInput();
    const trip = { ...original.trip, items: Array.from({ length: 60 }, (_, i) => ({ ...original.trip.items[0]!, id: `activity-${i}` })) }; f.seed(trip);
    const projection = new TripRecheckProjection(f.repository, f.watches, queue.repository,
      { resolve: async () => ({ scopes: trip.items.flatMap((item) => [
        { itineraryItemId: item.id, subject: original.watches[0]!.subject as { type: "weather-area"; area: string } },
        { itineraryItemId: item.id, subject: { type: "hazard-area" as const, area: "大阪府" } }]), unresolved: false }) },
      { now: () => new Date(areaNow) });
    f.watchFaults.failBatch = 2; await expect(projection.reconcile(owner, trip.id)).rejects.toThrow();
    expect((await f.watches.read(owner, trip.id)).complete).toBe(false); expect(queue.rows.size).toBe(0);
    f.watchFaults.failBatch = undefined; await projection.reconcile(owner, trip.id);
    expect((await f.watches.read(owner, trip.id)).complete).toBe(true); expect(queue.rows.size).toBe(120);
  });
  it("create projection, fresh weather -> Impact, duplicate execution never changes Trip/Watch/Reservation", async () => {
    const f = await setup(), before = structuredClone([...f.records.entries()]);
    await f.projection.reconcile(owner, f.trip.id); expect(f.queue.rows.size).toBe(1);
    await f.worker.poll(); expect(f.impactRows()).toHaveLength(1);
    for (let i = 0; i < 2; i++) { f.advanceToDue(); await f.worker.poll(); }
    expect(f.record).toHaveBeenCalledWith("ReplaySuccess", 1); expect(f.impactRows()).toHaveLength(1);
    // Ignore Watch metadata version from explicit reconcile; actual Trip and other resources are untouched.
    expect([...f.records.entries()].filter(([, r]) => r.sk?.S?.startsWith("TRIP#"))).toEqual(before.filter(([, r]) => r.sk?.S?.startsWith("TRIP#")));
    expect(JSON.stringify(f.record.mock.calls)).not.toContain("owner-A");
  });
  it("routes=0 remains pending and delayed fresh reingest recovers eventual index lag", async () => {
    const f = await setup(); f.impactFaults.routingRows = [];
    await f.worker.poll(); expect(f.impactRows()).toEqual([]);
    expect([...f.queue.rows.values()][0]!.deliveryState?.S).toBe("pending");
    f.advanceToDue(); f.impactFaults.routingRows = undefined; await f.worker.poll();
    expect(f.impactRows()).toHaveLength(1); f.advanceToDue(); await f.worker.poll();
    expect(f.record).toHaveBeenCalledWith("ReplaySuccess", 1);
  });
  it("permanently empty routing is bounded and dead-lettered, never global no-impact", async () => {
    const f = await setup(); f.impactFaults.routingRows = [];
    for (let i = 0; i < 12 && [...f.queue.rows.values()][0]!.deliveryState?.S !== "dead"; i++) { await f.worker.poll(); f.advanceToDue(); }
    expect([...f.queue.rows.values()][0]!.deliveryState?.S).toBe("dead");
    expect(f.record).not.toHaveBeenCalledWith("ReplaySuccess", 1); expect(f.impactRows()).toEqual([]);
  });
  it.each(["cancelled", "completed", "archived", "revision", "removed"])("%s skips old task and cannot reactivate Watch", async (mode) => {
    const f = await setup();
    if (mode === "archived") await f.repository.archive(owner, f.trip.id);
    else f.seed({ ...f.trip, ...(mode === "revision" ? { revision: 1 } : mode === "removed" ? { revision: 1, items: [] } : { lifecycleState: mode as "cancelled" | "completed" }) });
    if (mode === "removed") f.scopes.resolve.mockResolvedValue({ scopes: [], unresolved: false });
    await f.projection.reconcile(owner, f.trip.id);
    await f.worker.poll();
    if (mode !== "revision") expect(f.source.events).not.toHaveBeenCalled();
    expect([...f.queue.rows.values()].some((row) => row.deliveryState?.S === "inactive")).toBe(true);
    expect(f.record).toHaveBeenCalledWith("StaleRevisionSkip", 1);
  });
  it("date/revision change generates a new task, old task is not rebound to the new scope", async () => {
    const f = await setup(); f.seed({ ...f.trip, revision: 1, items: f.trip.items.map((item) => ({ ...item, schedule: { type: "day", date: "2026-11-01", timeZone: "Asia/Tokyo" } })) });
    await f.projection.reconcile(owner, f.trip.id); expect(f.queue.rows.size).toBe(2);
    await f.worker.poll(); expect(f.source.events).not.toHaveBeenCalled();
    expect([...f.queue.rows.values()].filter((row) => row.deliveryState?.S === "pending")).toHaveLength(1);
  });
  it("concurrent edit during provider fetch prevents stale dispatch", async () => {
    const f = await setup(); f.source.events.mockImplementation(async () => { f.seed({ ...f.trip, revision: 1 }); return [f.event]; });
    await f.worker.poll(); expect(f.impactRows()).toEqual([]);
    expect(f.record).toHaveBeenCalledWith("StaleRevisionSkip", 1);
  });
  it.each(["timeout", "rate_limited", "unavailable", "target_unknown"] as const)("%s retries/backoffs then DLQ without safe Impact, and operator can redrive", async (code) => {
    const f = await setup(); f.source.events.mockRejectedValue(new RecheckFailure(code));
    for (let i = 0; i < 8; i++) { await f.worker.poll(); if (i < 7) f.advanceToDue(); }
    const row = [...f.queue.rows.values()][0]!;
    expect(row.deliveryState?.S).toBe("dead"); expect(f.impactRows()).toEqual([]); expect(f.record).toHaveBeenCalledWith("DLQ", 1);
    f.source.events.mockResolvedValue([areaWeatherEvent()]);
    await f.queue.repository.redrive({ pk: row.pk!.S!, sk: row.sk!.S! }, Number(row.deliveryVersion!.N), f.clock.now().getTime());
    await f.worker.poll(); expect(f.record).toHaveBeenCalledWith("Executed", 1);
  });
  it("worker response lost after Impact commit is safely re-evaluated", async () => {
    const f = await setup(); f.impactFaults.lostResponse = true; await f.worker.poll();
    expect(f.impactRows()).toHaveLength(1); f.advanceToDue(); await f.worker.poll(); expect(f.impactRows()).toHaveLength(1);
  });
  it("poison task is isolated; another due task can progress", async () => {
    const f = await setup(); [...f.queue.rows.values()][0]!.task = { S: "{bad" };
    const next = { ...f.trip, id: "22222222-2222-4222-8222-222222222222" }; f.seed(next); await f.projection.reconcile(owner, next.id);
    await f.worker.poll(); expect(f.record).toHaveBeenCalledWith("DLQ", 1); expect(f.record).toHaveBeenCalledWith("Executed", 1);
  });
  it("outbox is not ACKed when task projection fails after successful Watch reconcile", async () => {
    const f = await setup(), finish = vi.fn(); f.queue.faults.fail = true;
    const claim = { key: { pk: "OWNER#owner-A", sk: "internal" }, version: 1, attempt: 1,
      event: { eventId: "internal", ownerSubject: owner.subject, tripId: f.trip.id, revision: 0, kind: "created" as const, changedAt: areaNow } };
    const consumer = new TripChangedConsumer({ due: async () => [claim.key], claim: async () => claim, finish }, f.projection, { record: vi.fn() }, f.clock);
    await consumer.poll(); expect(finish).toHaveBeenCalledWith(claim, "pending", f.clock.now().getTime());
    f.queue.faults.fail = false; await consumer.poll(); expect(finish).toHaveBeenCalledWith(claim, "done", f.clock.now().getTime());
  });
  it("unresolved target projection is retried, not falsely completed as readiness or Checklist", async () => {
    const f = await setup(); f.scopes.resolve.mockResolvedValue({ scopes: [], unresolved: true });
    await f.projection.reconcile(owner, f.trip.id); await f.worker.poll();
    expect(f.record).toHaveBeenCalledWith("TargetUnknown", 1); expect(f.source.events).not.toHaveBeenCalled();
  });
});
