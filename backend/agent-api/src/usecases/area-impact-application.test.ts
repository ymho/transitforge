import { describe, it, expect, vi } from "vitest";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { areaInput, areaNow, areaWeatherEvent, areaHazardEvent, weatherFixture } from "../../../../modules/trip/domain/area-trip-impact.fixture.js";
import { hazardInformation } from "../../../../modules/trip/domain/hazard-alert.fixture.js";
import { railImpactDynamoFixture } from "../adapters/rail-impact-dynamodb.fixture.js";
import { railWatchRoutingKey } from "../adapters/dynamodb-trip-watch-repository.js";
import { TripWatchApplication, TripWatchWorker } from "./trip-watch-application.js";
import { TripImpactApplication } from "./trip-impact-application.js";
import { DeterministicTripImpactEvaluator } from "./trip-impact-evaluator.js";
import { handler } from "../rail-impact-lambda.js";
import type { TravelEvent } from "@raiquora/trip/travel-event";

const a = { subject: "owner-A" }, b = { subject: "owner-B" }, clock = { now: () => new Date(areaNow) };
async function setup(event: TravelEvent = areaWeatherEvent()) {
  const f = railImpactDynamoFixture(), { trip } = areaInput(event); f.seed(trip);
  if (event.subject.type === "rail-service") throw new Error();
  const subject = event.subject;
  const sync = new TripWatchApplication(f.repository, f.watches, { resolve: async () => [{ itineraryItemId: "activity", subject }] });
  await sync.reconcile(a, trip.id);
  const evaluator = new DeterministicTripImpactEvaluator(), record = vi.fn();
  const worker = new TripWatchWorker(f.repository, f.watches, evaluator, { facts: async () => [] }, clock);
  const app = new TripImpactApplication(f.router, worker, f.repository, f.impacts, { record }, clock);
  return { ...f, trip, event, sync, evaluator, app, record };
}
const rows = (f: Awaited<ReturnType<typeof setup>>) => [...f.records.values()].filter((r) => r.sk?.S?.startsWith("IMPACT#"));
describe("shared area routing and Impact persistence", () => {
  it.each(["weather", "hazard"])("%s routes exact subject to multiple owners/Trips; no plan mutations or Scan", async (kind) => {
    const f = await setup(kind === "weather" ? areaWeatherEvent() : areaHazardEvent());
    f.seed(f.trip, b.subject); await f.sync.reconcile(b, f.trip.id);
    const second = { ...f.trip, id: "22222222-2222-4222-8222-222222222222" }; f.seed(second); await f.sync.reconcile(a, second.id);
    const before = structuredClone([...f.records.entries()]);
    expect(await f.app.process(f.event)).toMatchObject({ saved: 3, failed: 0, routedTrips: 3, replayRequired: true });
    expect(rows(f)).toHaveLength(3); expect([...f.records.entries()].filter(([, r]) => !r.sk?.S?.startsWith("IMPACT#"))).toEqual(before);
    expect(f.commands.some((c) => c instanceof Object && c.constructor.name === "ScanCommand")).toBe(false);
    const query = f.commands.find((c): c is QueryCommand => c instanceof QueryCommand && c.input.IndexName === "rail-watch-routing")!;
    expect(Object.keys(query.input.ExpressionAttributeValues!)).toEqual([":subject"]);
    expect(JSON.stringify(f.record.mock.calls)).not.toContain("owner-A");
  });
  it("unrelated area and weather-vs-hazard same name do not match; no-index is not no-impact", async () => {
    const f = await setup();
    expect((await f.router.route({ type: "weather-area", area: "other" })).routes).toEqual([]);
    expect((await f.router.route({ type: "hazard-area", area: "trusted:osaka-cell-1" })).routes).toEqual([]);
    f.impactFaults.routingRows = [];
    expect(await f.app.process(f.event)).toMatchObject({ saved: 0, routingCoverage: "eventual", replayRequired: true });
    expect(f.record).not.toHaveBeenCalledWith("NoImpact", 1);
    f.impactFaults.routingRows = undefined; expect((await f.app.process(f.event)).saved).toBe(1);
  });
  it.each(["inactive", "stale", "incomplete", "archive", "cancelled", "completed"])("%s routing hints cannot evaluate stale plans", async (mode) => {
    const f = await setup();
    f.impactFaults.routingRows = structuredClone([...f.records.values()].filter((r) => r.railSubject?.S === railWatchRoutingKey(f.event.subject)));
    if (mode === "inactive") {
      f.seed({ ...f.trip, lifecycleState: "cancelled" }); await f.sync.reconcile(a, f.trip.id);
    }
    if (mode === "stale") f.seed({ ...f.trip, revision: 1 });
    if (mode === "incomplete") [...f.records.values()].find((r) => r.sk?.S?.startsWith("WATCH_STATE#"))!.complete = { BOOL: false };
    if (mode === "archive") await f.repository.archive(a, f.trip.id);
    if (mode === "cancelled" || mode === "completed") f.seed({ ...f.trip, lifecycleState: mode });
    expect((await f.app.process(f.event)).saved).toBe(0); expect(rows(f)).toHaveLength(0);
  });
  it("same event / worker response lost is idempotent; owner fence and historical revision remain intact", async () => {
    const f = await setup(); f.impactFaults.lostResponse = true;
    expect((await f.app.process(f.event)).failed).toBe(1);
    expect((await f.app.process(f.event)).saved).toBe(1); expect(rows(f)).toHaveLength(1);
    const impact = JSON.parse(rows(f)[0]!.impact!.S!);
    expect(await f.impacts.read(b, f.trip.id, impact.id)).toBeUndefined();
    expect((await f.impacts.read(a, f.trip.id, impact.id))!.matchesTripRevision).toBe(true);
    f.seed({ ...f.trip, revision: 1 }); expect((await f.impacts.read(a, f.trip.id, impact.id))!.matchesTripRevision).toBe(false);
    await expect(f.impacts.save(b, f.trip, impact)).rejects.toMatchObject({ code: "conflict" });
  });
  it("Trip changed during evaluation or before transaction cannot save/rebase", async () => {
    const f = await setup(), original = f.evaluator.evaluate.bind(f.evaluator);
    const spy = vi.spyOn(f.evaluator, "evaluate").mockImplementation(async (input) => {
      const result = await original(input); f.seed({ ...f.trip, revision: 1 }); return result;
    });
    expect(await f.app.process(f.event)).toMatchObject({ saved: 0, skipped: 1 });
    spy.mockRestore(); await f.sync.reconcile(a, f.trip.id);
    f.impactFaults.beforeSave = () => f.seed({ ...f.trip, revision: 2 });
    expect(await f.app.process(f.event)).toMatchObject({ saved: 0, failed: 1 }); expect(rows(f)).toHaveLength(0);
  });
  it("old area Watch rows are repaired by the existing CAS reconcile, without changing IDs", async () => {
    const f = await setup(); for (const r of f.records.values()) delete r.railSubject;
    const before = [...f.records.keys()]; expect((await f.router.route(f.event.subject)).routes).toEqual([]);
    await f.sync.reconcile(a, f.trip.id);
    expect((await f.router.route(f.event.subject)).routes).toHaveLength(1); expect([...f.records.keys()]).toEqual(before);
  });
  it("internal ingest uses existing Hazard mapper and Weather normalization; forged owner/raw are rejected before IO", async () => {
    const f = await setup(), weather = weatherFixture();
    expect((await f.app.ingestWeather(weather.target, weather.result, areaNow)).saved).toBe(1);
    const hazard = await setup(areaHazardEvent());
    expect((await hazard.app.ingestHazard({ area: "大阪府" }, hazardInformation(), areaNow)).saved).toBe(1);
    await expect(f.app.process({ ...f.event, ownerSubject: "forged" } as never)).rejects.toThrow();
    await expect(handler({ ...f.event, ownerSubject: "forged" })).rejects.toThrow("rail-impact-processing-failed");
  });
});
