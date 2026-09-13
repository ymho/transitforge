import { describe, expect, it } from "vitest";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { watchTrip } from "../../../../modules/trip/domain/trip-watch.fixture.js";
import { projectTripWatches } from "@raiquora/trip/trip-watch";
import { tripChangedFixture as tripChangedStorageFixture } from "../adapters/trip-changed-dynamodb.fixture.js";
import { tripChangedPut } from "../adapters/trip-changed-record.js";
import { TripChangedConsumer, type DeliveryMetric } from "./trip-changed-consumer.js";
import { TripWatchApplication } from "./trip-watch-application.js";
import { tripChangedDelivery } from "../ports/trip-changed-outbox.js";
import type { Trip } from "@raiquora/trip/trip";

const owner = { subject: "owner-A" };
function tripChangedFixture() {
  const f = tripChangedStorageFixture(), metrics: [DeliveryMetric, number][] = [];
  const application = new TripWatchApplication(f.repository, f.watches);
  return { ...f, application, metrics, consumer: new TripChangedConsumer(f.outbox, application, { record: (n, v) => metrics.push([n, v]) }, f.clock) };
}
function signal(f: ReturnType<typeof tripChangedFixture>, trip: Trip, kind = "mutated" as const) {
  const r = tripChangedPut("test-trips", `OWNER#${owner.subject}`, trip.id, trip.revision, kind, f.clock.now().toISOString()).Put.Item;
  f.records.set(`${r.pk!.S}/${r.sk!.S}`, r); return r;
}
const active = async (f: ReturnType<typeof tripChangedFixture>, id: string) => (await f.watches.read(owner, id)).records.filter((r) => r.active);
describe("durable TripChanged consumer using #393 reconcile", () => {
  it("atomically creates a minimal signal, generates watches, and retries create without duplicate events", async () => {
    const f = tripChangedFixture(), trip = watchTrip();
    await f.repository.create(owner, trip); await f.repository.create(owner, trip);
    expect(f.deliveries()).toHaveLength(1);
    const event = JSON.parse(f.deliveries()[0]!.event!.S!);
    expect(Object.keys(event).sort()).toEqual(["changedAt", "eventId", "kind", "ownerSubject", "revision", "tripId"]);
    expect(JSON.stringify(event)).not.toMatch(/旅|schedule|place|party|Reservation/);
    const transaction = f.commands.find((c) => c instanceof TransactWriteItemsCommand) as TransactWriteItemsCommand;
    expect(transaction.input.TransactItems).toHaveLength(2);
    await f.consumer.poll(); await f.consumer.poll();
    expect(await active(f, trip.id)).toHaveLength(2);
    expect(f.deliveries()[0]!.deliveryState?.S).toBe("done");
    expect(f.metrics.map(([n]) => n)).toContain("ProjectionLagMs");
  });
  it("CAS mutation stores outbox with receipt, failed CAS writes neither, retry emits one signal", async () => {
    const f = tripChangedFixture(), trip = watchTrip(); await f.repository.create(owner, trip);
    const mutation = { tripId: trip.id, baseRevision: 0, mutationId: "22222222-2222-4222-8222-222222222222",
      proposal: { tripId: trip.id, baseRevision: 0, summary: "remove", patches: [] } };
    f.faults.lostResponse = true;
    await f.repository.applyMutation(owner, mutation, (t) => ({ ...t, items: [] }));
    await f.repository.applyMutation(owner, mutation, (t) => t);
    expect(f.deliveries()).toHaveLength(2);
    await expect(f.repository.applyMutation(owner, { ...mutation, mutationId: trip.id }, (t) => t)).rejects.toMatchObject({ code: "conflict" });
    expect(f.deliveries()).toHaveLength(2);
    await f.consumer.poll(); expect(await active(f, trip.id)).toEqual([]);
  });
  it.each(["forward", "reverse"])("rev5/rev6 %s delivery converges to latest saved revision", async (order) => {
    const f = tripChangedFixture(), trip = { ...watchTrip(), revision: 5 }; f.seed(trip);
    signal(f, trip); await f.consumer.poll();
    const next = { ...trip, revision: 6, items: [] }; f.seed(next); signal(f, next);
    const old = f.deliveries().find((r) => JSON.parse(r.event!.S!).revision === 5)!;
    old.deliveryState = { S: "pending" }; old.availableAt = { N: String(f.clock.now().getTime()) }; // duplicate/replay old event
    const freshOld = tripChangedPut("test-trips", `OWNER#${owner.subject}`, trip.id, 5, "mutated", f.clock.now().toISOString()).Put.Item;
    old.outboxShard = freshOld.outboxShard!;
    const keys = await f.outbox.due(f.clock.now().getTime());
    keys.sort((a, b) => {
      const rev = (k: typeof a) => JSON.parse(f.records.get(`${k.pk}/${k.sk}`)!.event!.S!).revision;
      return (rev(a) - rev(b)) * (order === "forward" ? 1 : -1);
    });
    const consumer = new TripChangedConsumer({ due: async () => keys, claim: f.outbox.claim.bind(f.outbox), finish: f.outbox.finish.bind(f.outbox) }, f.application,
      { record: (n, v) => f.metrics.push([n, v]) }, f.clock);
    await consumer.poll();
    expect(await active(f, trip.id)).toEqual([]);
    expect((await f.watches.read(owner, trip.id)).sourceTripRevision).toBe(6);
    expect(f.metrics.map(([n]) => n)).toContain("DuplicateOrStale");
  });
  it("rail A to B, different date, and removal converge without deleting inactive history", async () => {
    const f = tripChangedFixture(), trip = watchTrip(); await f.repository.create(owner, trip); await f.consumer.poll();
    const mutate = async (items: Trip["items"], baseRevision: number) => {
      const digit = String(baseRevision + 3), mutationId = `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
      return f.repository.applyMutation(owner, { tripId: trip.id, baseRevision, mutationId,
        proposal: { tripId: trip.id, baseRevision, summary: "変更", patches: [] } }, (t) => ({ ...t, items }));
    };
    // Fixture modification of the whole validated snapshot, including provenance identities/date facts.
    const replacement = { ...JSON.parse(JSON.stringify(trip).replaceAll('s1', 's3').replaceAll('s2', 's4')), revision: 1 } as Trip;
    await mutate(replacement.items, 0); await f.consumer.poll();
    expect((await active(f, trip.id)).map((r) => r.watch.subject)).toEqual(expect.arrayContaining(projectTripWatches(replacement).map((w) => w.subject)));
    expect((await f.watches.read(owner, trip.id)).records.filter((r) => !r.active)).toHaveLength(2);
    const dated = { ...JSON.parse(JSON.stringify(replacement).replaceAll("2026-09-13", "2026-09-14")), revision: 2 } as Trip;
    await mutate(dated.items, 1); await f.consumer.poll();
    expect((await active(f, trip.id)).every((r) => r.watch.subject.type === "rail-service" && r.watch.subject.serviceDate === "2026-09-14")).toBe(true);
    await mutate([], 2); await f.consumer.poll();
    expect(await active(f, trip.id)).toEqual([]);
    expect((await f.watches.read(owner, trip.id)).records).toHaveLength(6);
  });
  it.each(["archive", "cancelled", "completed", "missing"])("%s deactivates existing Watch records", async (kind) => {
    const f = tripChangedFixture(), trip = watchTrip(); await f.repository.create(owner, trip); await f.consumer.poll();
    if (kind === "archive") await f.repository.archive(owner, trip.id);
    else {
      const next = { ...trip, revision: 1, ...(kind === "missing" ? {} : { lifecycleState: kind as "cancelled" | "completed" }) };
      f.seed(next); signal(f, next);
      if (kind === "missing") f.records.delete(`OWNER#owner-A/TRIP#${trip.id}`);
    }
    await f.consumer.poll();
    expect(await active(f, trip.id)).toEqual([]);
    expect((await f.watches.read(owner, trip.id)).records).toHaveLength(2);
  });
  it("missing Trip with no prior Watch is acknowledged, not infinitely retried", async () => {
    const f = tripChangedFixture(); signal(f, watchTrip()); await f.consumer.poll();
    expect(f.deliveries()[0]!.deliveryState?.S).toBe("done");
  });
  it("lost claim response expires lease; lost success response and duplicate tick never multiply Watch", async () => {
    const f = tripChangedFixture(), trip = watchTrip(); await f.repository.create(owner, trip);
    f.deliveryFaults.lostClaim = true; await expect(f.consumer.poll()).rejects.toThrow();
    await f.consumer.poll(); expect(await active(f, trip.id)).toEqual([]);
    f.advance(); f.deliveryFaults.lostAck = true; await expect(f.consumer.poll()).rejects.toThrow();
    f.advance(); await f.consumer.poll(); expect(await active(f, trip.id)).toHaveLength(2);
    expect(f.deliveries()[0]!.deliveryState?.S).toBe("done");
  });
  it("partial Watch batch failure retries existing residual reconcile, never acknowledges incomplete set", async () => {
    const f = tripChangedFixture(), original = watchTrip();
    const trip = { ...original, items: Array.from({ length: 60 }, (_, n) => ({ ...original.items[0]!, id: `rail-${n}` })) };
    await f.repository.create(owner, trip); f.watchFaults.failBatch = 2; await f.consumer.poll();
    expect((await f.watches.read(owner, trip.id)).complete).toBe(false);
    expect(f.deliveries()[0]!.deliveryState?.S).toBe("pending");
    f.advance(); await f.consumer.poll();
    expect(await active(f, trip.id)).toHaveLength(120);
    expect((await f.watches.read(owner, trip.id)).complete).toBe(true);
    expect(f.metrics.map(([n]) => n)).toContain("Retry");
  });
  it("bounded failure retry enters durable DLQ; poison is isolated from healthy Trip", async () => {
    const f = tripChangedFixture(), trip = watchTrip(); await f.repository.create(owner, trip);
    const consumer = new TripChangedConsumer(f.outbox, { reconcile: async () => { throw new Error("private-party"); } }, { record: (n, v) => f.metrics.push([n, v]) }, f.clock);
    for (let n = 0; n < tripChangedDelivery.maxAttempts; n++) { await consumer.poll(); f.advance(1_800_001); }
    expect(f.deliveries()[0]!.deliveryState?.S).toBe("dead");
    expect(f.deliveries()[0]!.attempts?.N).toBe("8");
    expect(f.metrics.map(([n]) => n)).toContain("DLQ");
    expect(JSON.stringify(f.metrics)).not.toMatch(/owner-A|private-party|tripId/);
    const dead = f.deliveries()[0]!;
    await f.outbox.redrive({ pk: dead.pk!.S!, sk: dead.sk!.S! }, Number(dead.deliveryVersion!.N), f.clock.now().getTime());
    await f.consumer.poll();
    expect(f.deliveries()[0]!.deliveryState?.S).toBe("done");
    expect(await active(f, trip.id)).toHaveLength(2);
  });
  it.each(["foreign-owner", "malformed", "raw", "invalid-metadata"])("quarantines %s, does not trust payload owner or block a healthy record", async (poison) => {
    const f = tripChangedFixture(), trip = watchTrip(); await f.repository.create(owner, trip);
    const row = f.deliveries()[0]!, event = JSON.parse(row.event!.S!);
    if (poison === "invalid-metadata") row.attempts = { S: "invalid" };
    else row.event = { S: poison === "malformed" ? "{" : JSON.stringify(poison === "raw" ? { ...event, private: "booking-secret" } : { ...event, ownerSubject: "owner-B" }) };
    const second = { ...trip, id: "22222222-2222-4222-8222-222222222222" }; await f.repository.create(owner, second);
    await f.consumer.poll();
    expect(f.deliveries().filter((r) => r.deliveryState?.S === "dead")).toHaveLength(1);
    expect(await active(f, second.id)).toHaveLength(2);
    expect((await f.watches.read({ subject: "owner-B" }, trip.id)).records).toEqual([]);
    expect(JSON.stringify(f.deliveries())).not.toContain("booking-secret");
  });
  it("database outage never acknowledges pending work; no Scan is used", async () => {
    const f = tripChangedFixture(); await f.repository.create(owner, watchTrip()); f.deliveryFaults.failRead = true;
    await expect(f.consumer.poll()).rejects.toThrow(); expect(f.deliveries()[0]!.deliveryState?.S).toBe("pending");
    f.deliveryFaults.failRead = false; await f.consumer.poll();
    expect(f.commands.every((c) => (c as object).constructor.name !== "ScanCommand")).toBe(true);
  });
  it("transaction rejection cannot persist only a Trip or only a signal", async () => {
    const f = tripChangedFixture(), trip = watchTrip();
    f.faults.beforeTransaction = () => { throw new Error("database unavailable"); };
    await expect(f.repository.create(owner, trip)).rejects.toMatchObject({ code: "unavailable" });
    expect(await f.repository.get(owner, trip.id)).toBeUndefined(); expect(f.deliveries()).toEqual([]);
    f.faults.beforeTransaction = undefined; await f.repository.create(owner, trip);
    f.faults.beforeTransaction = () => f.seed({ ...trip, revision: 1 });
    await expect(f.repository.archive(owner, trip.id)).rejects.toMatchObject({ code: "conflict" });
    expect(await f.repository.get(owner, trip.id)).toBeDefined();
    expect(f.deliveries().map((r) => JSON.parse(r.event!.S!).kind)).toEqual(["created"]);
  });
  it("concurrent claim is CAS-protected; persisted lease expires after worker crash", async () => {
    const f = tripChangedFixture(); await f.repository.create(owner, watchTrip());
    const [key] = await f.outbox.due(f.clock.now().getTime());
    const claims = await Promise.all([f.outbox.claim(key!, f.clock.now().getTime()), f.outbox.claim(key!, f.clock.now().getTime())]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    f.advance(); const recovered = await f.outbox.claim(key!, f.clock.now().getTime());
    expect(recovered?.attempt).toBe(2);
    await expect(f.outbox.finish(claims.find(Boolean)!, "done", f.clock.now().getTime())).rejects.toThrow();
    expect(f.deliveries()[0]!.deliveryState?.S).toBe("pending");
  });
});
