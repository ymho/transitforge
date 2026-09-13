import { describe, expect, it, vi } from "vitest";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { impactEvent, impactNow, impactInput } from "../../../../modules/trip/domain/rail-trip-impact.fixture.js";
import { watchTrip } from "../../../../modules/trip/domain/trip-watch.fixture.js";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture.js";
import { evaluateRailTripImpact } from "@raiquora/trip/rail-trip-impact";
import { railWatchRoutingKey } from "../adapters/dynamodb-trip-watch-repository.js";
import { railImpactDynamoFixture } from "../adapters/rail-impact-dynamodb.fixture.js";
import { TripWatchApplication, TripWatchWorker } from "./trip-watch-application.js";
import { RailImpactApplication } from "./rail-impact-application.js";
import { RailTripImpactEvaluator } from "./rail-trip-impact-evaluator.js";
import { handler } from "../rail-impact-lambda.js";

const ownerA = { subject: "owner-A" }, ownerB = { subject: "owner-B" }, now = { now: () => new Date(impactNow) };
async function setup() {
  const f = railImpactDynamoFixture(), trip = watchTrip(); f.seed(trip);
  const sync = new TripWatchApplication(f.repository, f.watches);
  await sync.reconcile(ownerA, trip.id);
  const facts = vi.fn(async () => []), record = vi.fn();
  const evaluator = new RailTripImpactEvaluator();
  const worker = new TripWatchWorker(f.repository, f.watches, evaluator, { facts }, now);
  const app = new RailImpactApplication(f.router, worker, f.repository, f.impacts, { record }, now);
  return { ...f, trip, sync, app, record, worker, facts, evaluator };
}
const impactRows = (f: Awaited<ReturnType<typeof setup>>) => [...f.records.values()].filter((r) => r.sk?.S?.startsWith("IMPACT#"));

describe("subject-only internal rail impact fanout", () => {
  it("routes one service to multiple owners and multiple Trips without a caller owner list; saves independently", async () => {
    const f = await setup(); f.seed(f.trip, ownerB.subject);
    const second = { ...f.trip, id: "33333333-3333-4333-8333-333333333333" }; f.seed(second);
    await f.sync.reconcile(ownerB, f.trip.id); await f.sync.reconcile(ownerA, second.id);
    const before = structuredClone([...f.records.entries()]);
    const result = await f.app.process(impactEvent(6)); expect(result).toMatchObject({ saved: 3, failed: 0, routedTrips: 3, routingCoverage: "eventual", replayRequired: true });
    expect(f.record).toHaveBeenCalledWith("RoutedOwners", 2); expect(f.record).toHaveBeenCalledWith("Impact", 1);
    expect(impactRows(f)).toHaveLength(3);
    expect([...f.records.entries()].filter(([, r]) => !r.sk?.S?.startsWith("IMPACT#"))).toEqual(before);
    const queries = f.commands.filter((c): c is QueryCommand => c instanceof QueryCommand);
    const routing = queries.find((c) => c.input.IndexName === "rail-watch-routing")!;
    expect(Object.keys(routing.input.ExpressionAttributeValues!)).toEqual([":subject"]);
    expect(queries.some((c) => c.input.ConsistentRead === true && c.input.ExpressionAttributeValues![":owner"]?.S === "OWNER#owner-B")).toBe(true);
    expect(f.commands.some((c) => c!.constructor.name === "ScanCommand")).toBe(false);
    expect(JSON.stringify(f.record.mock.calls)).not.toContain("owner-A");
  });
  it("duplicate event / lost worker response is safe to replay", async () => {
    const f = await setup(); f.impactFaults.lostResponse = true;
    expect((await f.app.process(impactEvent(6))).failed).toBe(1);
    expect((await f.app.process(impactEvent(6))).saved).toBe(1);
    expect((await f.app.process(impactEvent(6))).saved).toBe(1); expect(impactRows(f)).toHaveLength(1);
  });
  it("index empty/partial means eventual coverage, not no-impact; same event can later find the Trip", async () => {
    const f = await setup(); f.impactFaults.routingRows = [];
    expect(await f.app.process(impactEvent())).toMatchObject({ saved: 0, routedTrips: 0, replayRequired: true });
    expect(f.record).not.toHaveBeenCalledWith("NoImpact", 1);
    f.impactFaults.routingRows = undefined; expect((await f.app.process(impactEvent())).saved).toBe(1);
    f.watchFaults.indexed = []; // owner GSI can lag independently of subject routing
    expect(await f.app.process(impactEvent())).toMatchObject({ saved: 0, replayRequired: true });
  });
  it.each(["inactive", "partial", "stale", "archived", "cancelled", "completed"])("rechecks %s base Watch/Trip after routing", async (mode) => {
    const f = await setup(); f.impactFaults.routingRows = structuredClone([...f.records.values()].filter((r) => r.railSubject?.S === railWatchRoutingKey(impactEvent().subject)));
    if (mode === "inactive") { f.seed({ ...f.trip, items: [] }); await f.sync.reconcile(ownerA, f.trip.id); }
    if (mode === "partial") [...f.records.values()].find((r) => r.sk?.S?.startsWith("WATCH_STATE#"))!.complete = { BOOL: false };
    if (mode === "stale") f.seed({ ...f.trip, revision: 1 });
    if (mode === "archived") await f.repository.archive(ownerA, f.trip.id);
    if (mode === "cancelled" || mode === "completed") f.seed({ ...f.trip, lifecycleState: mode, planningState: "itinerary_refinement" });
    expect((await f.app.process(impactEvent())).saved).toBe(0); expect(impactRows(f)).toHaveLength(0);
  });
  it("Reservation read failure is not an empty list/safe impact; another owner can still succeed", async () => {
    const f = await setup(); f.seed(f.trip, ownerB.subject); await f.sync.reconcile(ownerB, f.trip.id);
    f.facts.mockRejectedValueOnce(new Error("private booking data"));
    expect(await f.app.process(impactEvent())).toMatchObject({ saved: 1, failed: 1, replayRequired: true });
    expect(f.record).toHaveBeenCalledWith("EvaluationFailure", 1); expect(JSON.stringify(f.record.mock.calls)).not.toContain("private");
  });
  it("concurrent Trip mutation during evaluation or at persistence rejects stale output", async () => {
    const f = await setup();
    const original = f.evaluator.evaluate.bind(f.evaluator);
    const spy = vi.spyOn(f.evaluator, "evaluate").mockImplementation(async (input) => { const result = await original(input); f.seed({ ...f.trip, revision: 1 }); return result; });
    expect(await f.app.process(impactEvent())).toMatchObject({ saved: 0, skipped: 1 });
    spy.mockRestore(); await f.sync.reconcile(ownerA, f.trip.id);
    f.impactFaults.beforeSave = () => f.seed({ ...f.trip, revision: 2 });
    expect(await f.app.process(impactEvent())).toMatchObject({ saved: 0, failed: 1 });
    expect(f.record).toHaveBeenCalledWith("PersistenceConflict", 1); expect(impactRows(f)).toHaveLength(0);
  });
  it("rejects public owner payload / malformed or non-rail events before IO", async () => {
    const f = await setup();
    await expect(f.app.process({ ...impactEvent(), ownerSubject: "forged" } as never)).rejects.toThrow();
    await expect(handler({ ...impactEvent(), ownerSubject: "forged" })).rejects.toThrow("rail-impact-processing-failed");
    expect(f.record).not.toHaveBeenCalled();
    f.impactFaults.routingRows = [{ pk: { S: "OWNER#forged" }, sk: { S: "WATCH#no" }, railSubject: { S: "wrong" } }];
    await expect(f.app.process(impactEvent())).rejects.toThrow();
  });
  it("ingest reuses railTravelEvent unique dated binding, including ambiguous -> unknown", async () => {
    const f = await setup(), source = impactEvent().sources, index = railSelectionFixture().inputs[0]!.index;
    const subject = { type: "rail-service" as const, serviceDate: "2026-09-13", serviceUid: "s1", trainNumber: "1M" };
    expect((await f.app.ingest(subject, { ...index, trains: [...index.trains, { ...index.trains[0]!, service_uid: "ambiguous" }] }, undefined, source, impactNow)).saved).toBe(1);
    const result = JSON.parse(impactRows(f)[0]!.impact!.S!); expect(result.status).toBe("unknown");
    expect(result.facts.every((fact: { type: string }) => fact.type === "uncertainty")).toBe(true);
  });
});

describe("impact persistence and routing migration", () => {
  it("owner isolation, idempotence, historical old revision and archive visibility", async () => {
    const f = await setup(), impact = evaluateRailTripImpact(impactInput(6));
    await f.impacts.save(ownerA, f.trip, impact); await f.impacts.save(ownerA, f.trip, impact);
    expect(impactRows(f)).toHaveLength(1);
    expect(await f.impacts.read(ownerB, f.trip.id, impact.id)).toBeUndefined();
    await expect(f.impacts.save(ownerB, f.trip, impact)).rejects.toMatchObject({ code: "conflict" });
    expect((await f.impacts.read(ownerA, f.trip.id, impact.id))!.matchesTripRevision).toBe(true);
    f.seed({ ...f.trip, revision: 1 });
    expect((await f.impacts.read(ownerA, f.trip.id, impact.id))!.matchesTripRevision).toBe(false);
    await expect(f.impacts.save(ownerA, f.trip, impact)).rejects.toMatchObject({ code: "conflict" });
    await f.repository.archive(ownerA, f.trip.id);
    expect((await f.impacts.read(ownerA, f.trip.id, impact.id))!.matchesTripRevision).toBe(false);
    expect(impactRows(f)).toHaveLength(1);
  });
  it("unchanged legacy Watch rows gain routing via existing guarded reconcile, no new IDs/Trip writes", async () => {
    const f = await setup();
    for (const row of f.records.values()) delete row.railSubject;
    const ids = [...f.records.keys()], before = await f.repository.get(ownerA, f.trip.id);
    const subject = impactEvent().subject;
    if (subject.type !== "rail-service") throw new Error();
    expect((await f.router.route(subject)).routes).toEqual([]);
    await f.sync.reconcile(ownerA, f.trip.id);
    expect((await f.router.route(subject)).routes).toHaveLength(1);
    expect([...f.records.keys()]).toEqual(ids); expect(await f.repository.get(ownerA, f.trip.id)).toEqual(before);
  });
  it("Impact reader rejects stored raw payload/corrupted identity and private booking fields", async () => {
    const f = await setup(), impact = evaluateRailTripImpact(impactInput(6)); await f.impacts.save(ownerA, f.trip, impact);
    const row = impactRows(f)[0]!;
    row.impact = { S: JSON.stringify({ ...impact, bookingReference: "private" }) };
    await expect(f.impacts.read(ownerA, f.trip.id, impact.id)).rejects.toMatchObject({ code: "unavailable" });
    await expect(f.impacts.save(ownerA, f.trip, { ...impact, sent: true } as never)).rejects.toThrow();
    await expect(f.impacts.save(undefined as never, f.trip, impact)).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("subject routing consumes every Query page, including identical Trip IDs under different owners", async () => {
    const f = await setup();
    for (let i = 0; i < 100; i++) {
      const principal = { subject: `synthetic-owner-${i}` }; f.seed(f.trip, principal.subject); await f.sync.reconcile(principal, f.trip.id);
    }
    const subject = impactEvent().subject;
    if (subject.type !== "rail-service") throw new Error();
    const routed = await f.router.route(subject); expect(routed.routes).toHaveLength(101);
    const pages = f.commands.filter((c): c is QueryCommand => c instanceof QueryCommand && c.input.IndexName === "rail-watch-routing");
    expect(pages).toHaveLength(2); expect(pages[1]!.input.ExclusiveStartKey).toBeDefined();
  });
  it("base lookup rejects forged index owner and wrong subject; inactive rows are sparse", async () => {
    const f = await setup(), subject = impactEvent().subject;
    if (subject.type !== "rail-service") throw new Error();
    f.impactFaults.routingRows = [...f.records.values()].filter((r) => r.railSubject?.S === railWatchRoutingKey(subject)).map((r) => ({ ...r, pk: { S: "OWNER#stranger" } }));
    expect((await f.router.route(subject)).routes).toHaveLength(0);
    f.impactFaults.routingRows = undefined;
    f.seed({ ...f.trip, items: [] }); await f.sync.reconcile(ownerA, f.trip.id);
    expect([...f.records.values()].filter((r) => r.railSubject)).toHaveLength(0);
  });
  it("rail replacement removes old subject routing and adds the new subject in the same reconcile", async () => {
    const f = await setup(), item = f.trip.items[0]!;
    if (item.type !== "transport" || item.detail.mode !== "rail" || item.detail.status !== "selected") throw new Error();
    const changed = { ...f.trip, revision: 1, items: [{ ...item, detail: { ...item.detail, journey: { ...item.detail.journey,
      legs: item.detail.journey.legs.map((leg) => ({ ...leg, serviceUid: `replacement-${leg.serviceUid}` })) } } }] };
    f.seed(changed); await f.sync.reconcile(ownerA, f.trip.id);
    const subject = impactEvent().subject;
    if (subject.type !== "rail-service") throw new Error();
    expect((await f.router.route(subject)).routes).toHaveLength(0);
    expect((await f.router.route({ ...subject, serviceUid: "replacement-s1" })).routes).toHaveLength(1);
    expect([...f.records.values()].filter((r) => r.sk?.S?.startsWith("WATCH#") && r.active?.BOOL === false).every((r) => r.railSubject === undefined)).toBe(true);
  });
  it("partial Watch batch remains invisible; existing reconcile repairs it and same event is replayed", async () => {
    const f = await setup(), originalItem = f.trip.items[0]!;
    const large = { ...f.trip, revision: 1, items: Array.from({ length: 50 }, (_, i) => ({ ...originalItem, id: `rail-${i}` })) };
    f.seed(large); f.watchFaults.failBatch = 3; // setup=1, first partial batch=2, second=3
    await expect(f.sync.reconcile(ownerA, f.trip.id)).rejects.toThrow();
    expect((await f.app.process(impactEvent())).saved).toBe(0);
    f.watchFaults.failBatch = undefined; await f.sync.reconcile(ownerA, f.trip.id);
    expect((await f.app.process(impactEvent())).saved).toBe(1);
    const stored = JSON.parse(impactRows(f)[0]!.impact!.S!); expect(stored.affectedItemIds).toHaveLength(50);
  });
});
