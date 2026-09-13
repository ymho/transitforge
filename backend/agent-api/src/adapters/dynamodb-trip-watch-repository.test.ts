import { describe, expect, it } from "vitest";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { watchTrip } from "../../../../modules/trip/domain/trip-watch.fixture.js";
import { projectTripWatches } from "@raiquora/trip/trip-watch";
import { TripWatchApplication } from "../usecases/trip-watch-application.js";
import type { TripPrincipal } from "../ports/trip-repository.js";
import { watchDynamoFixture } from "./watch-dynamodb.fixture.js";

const owner = { subject: "owner-A" }, other = { subject: "owner-B" };
function fixture() {
  const f = watchDynamoFixture(), trip = watchTrip(); f.seed(trip);
  return { ...f, trip, application: new TripWatchApplication(f.repository, f.watches) };
}
describe("owner-scoped Watch persistence and reverse lookup", () => {
  it("creates, retries without rewriting identities, Queries exact subject, preserves plans", async () => {
    const f = fixture(), before = await f.repository.get(owner, f.trip.id);
    expect(await f.application.reconcile(owner, f.trip.id)).toMatchObject({ changed: 2 });
    expect(await f.application.reconcile(owner, f.trip.id)).toMatchObject({ changed: 0, unchanged: 2 });
    const read = await f.watches.read(owner, f.trip.id);
    expect(read.records).toHaveLength(2); expect(read.complete).toBe(true);
    expect(await f.watches.find(owner, read.records[0]!.watch.subject)).toEqual([read.records[0]]);
    expect(await f.repository.get(owner, f.trip.id)).toEqual(before);
    expect(f.commands.some((c) => c instanceof QueryCommand && c.input.IndexName === "watch-subject")).toBe(true);
    expect(f.commands.every((c) => (c as object).constructor.name !== "ScanCommand")).toBe(true);
  });
  it("isolates A/B, validates missing principal and cannot deactivate another owner's watches", async () => {
    const f = fixture(); await f.application.reconcile(owner, f.trip.id);
    const subject = projectTripWatches(f.trip)[0]!.subject;
    expect(await f.watches.find(other, subject)).toEqual([]);
    expect((await f.watches.read(other, f.trip.id)).records).toEqual([]);
    await expect(f.application.reconcile(other, f.trip.id)).rejects.toMatchObject({ code: "not-found" });
    for (const action of [() => f.watches.read(undefined as unknown as TripPrincipal, f.trip.id),
      () => f.watches.find(undefined as unknown as TripPrincipal, subject),
      () => f.application.reconcile(undefined as unknown as TripPrincipal, f.trip.id)]) await expect(action()).rejects.toMatchObject({ code: "unauthenticated" });
    f.seed(f.trip, "owner-B"); await f.application.reconcile(other, f.trip.id);
    expect(await f.watches.find(other, subject)).toHaveLength(1);
    expect(await f.watches.find(owner, subject)).toHaveLength(1);
  });
  it("deactivates removed/archive watches; eventual index hit is reread and filtered", async () => {
    const f = fixture(); await f.application.reconcile(owner, f.trip.id);
    const subject = projectTripWatches(f.trip)[0]!.subject;
    f.watchFaults.indexed = [...f.records.values()].filter((r) => r.watchSubject?.S && JSON.parse(r.watch!.S!).subject.serviceUid === "s1");
    f.seed({ ...f.trip, revision: 1, items: [] });
    await f.application.reconcile(owner, f.trip.id);
    expect((await f.watches.read(owner, f.trip.id)).records.every((r) => !r.active)).toBe(true);
    expect(await f.watches.find(owner, subject)).toEqual([]);
    f.seed({ ...f.trip, revision: 2 }); await f.application.reconcile(owner, f.trip.id);
    await f.repository.archive(owner, f.trip.id); await f.application.reconcile(owner, f.trip.id);
    expect((await f.watches.read(owner, f.trip.id)).records.every((r) => !r.active)).toBe(true);
  });
  it("rejects old sync after concurrent Trip write/archive; reconcile recovers saved current revision", async () => {
    const f = fixture();
    f.watchFaults.beforeTransaction = () => f.seed({ ...f.trip, revision: 1 });
    await expect(f.application.reconcile(owner, f.trip.id)).rejects.toMatchObject({ code: "conflict" });
    expect((await f.watches.read(owner, f.trip.id)).records).toEqual([]);
    await f.application.reconcile(owner, f.trip.id);
    const base = await f.watches.read(owner, f.trip.id);
    expect(base.sourceTripRevision).toBe(1);
    await expect(f.watches.commit(owner, f.trip.id, base, f.trip, [])).rejects.toMatchObject({ code: "conflict" });
    const current = { ...f.trip, revision: 1 };
    await f.repository.archive(owner, f.trip.id);
    await expect(f.watches.commit(owner, f.trip.id, base, current, [])).rejects.toMatchObject({ code: "conflict" });
  });
  it("lost response retry is idempotent and competing same-revision collection commits conflict", async () => {
    const f = fixture(); f.watchFaults.lostResponse = true;
    await expect(f.application.reconcile(owner, f.trip.id)).rejects.toMatchObject({ code: "unavailable" });
    const old = await f.watches.read(owner, f.trip.id);
    expect(await f.application.reconcile(owner, f.trip.id)).toMatchObject({ changed: 0 });
    await expect(f.watches.commit(owner, f.trip.id, old, f.trip, [])).rejects.toMatchObject({ code: "conflict" });
    expect((await f.watches.read(owner, f.trip.id)).records).toHaveLength(2);
  });
  it("batch failure hides incomplete coverage; reconcile resumes differential rows and publishes all", async () => {
    const f = fixture(), rail = f.trip.items[0]!;
    const trip = { ...f.trip, items: Array.from({ length: 60 }, (_, n) => ({ ...rail, id: `rail-${n}` })) };
    f.seed(trip); f.watchFaults.failBatch = 2;
    await expect(f.application.reconcile(owner, trip.id)).rejects.toMatchObject({ code: "unavailable" });
    const partial = await f.watches.read(owner, trip.id);
    expect(partial.complete).toBe(false); expect(partial.records).toHaveLength(98);
    expect(await f.watches.find(owner, partial.records[0]!.watch.subject)).toEqual([]);
    const recovered = await f.application.reconcile(owner, trip.id);
    expect(recovered.changed).toBe(22); expect(recovered.unchanged).toBe(98);
    const full = await f.watches.read(owner, trip.id);
    expect(full.complete).toBe(true); expect(full.records).toHaveLength(120);
    expect(await f.watches.find(owner, full.records[0]!.watch.subject)).toHaveLength(60);
  });
  it("rejects malformed persisted data/foreign index rows without leaking private fields", async () => {
    const f = fixture(); await f.application.reconcile(owner, f.trip.id);
    const subject = projectTripWatches(f.trip)[0]!.subject;
    const row = [...f.records.values()].find((r) => r.watchSubject)!;
    f.watchFaults.indexed = [{ ...row, pk: { S: "OWNER#owner-B" } }];
    await expect(f.watches.find(owner, subject)).rejects.toMatchObject({ code: "unavailable" });
    row.watch = { S: JSON.stringify({ ...JSON.parse(row.watch!.S!), notified: true }) };
    await expect(f.watches.read(owner, f.trip.id)).rejects.toMatchObject({ code: "unavailable" });
  });
  it("a newer saved revision supersedes failed partial sync without reviving removed watches", async () => {
    const f = fixture(), rail = f.trip.items[0]!;
    const trip = { ...f.trip, items: Array.from({ length: 60 }, (_, n) => ({ ...rail, id: `rail-${n}` })) };
    f.seed(trip); f.watchFaults.failBatch = 2;
    await expect(f.application.reconcile(owner, trip.id)).rejects.toMatchObject({ code: "unavailable" });
    const oldBase = await f.watches.read(owner, trip.id);
    f.seed({ ...trip, revision: 1, items: [rail] });
    await f.application.reconcile(owner, trip.id);
    const latest = await f.watches.read(owner, trip.id);
    expect(latest.complete).toBe(true); expect(latest.sourceTripRevision).toBe(1);
    expect(latest.records.filter((r) => r.active)).toHaveLength(2);
    expect(latest.records.filter((r) => !r.active)).toHaveLength(98);
    await expect(f.watches.commit(owner, trip.id, oldBase, trip, [])).rejects.toMatchObject({ code: "conflict" });
    expect(await f.watches.read(owner, trip.id)).toEqual(latest);
  });
});
