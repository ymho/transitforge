import { describe, expect, it } from "vitest";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { createTrip } from "@raiquora/trip/trip";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { createTripApiHandler } from "../trip-handler.js";
import { TripApplication } from "../usecases/trip-application.js";

const owner = { subject: "owner-A" }, otherOwner = { subject: "owner-B" };
const id = "11111111-1111-4111-8111-111111111111";
const initial = { ...createTrip(id, "旅行", "2026-09-13T01:00:00Z"), revision: 5 };
const request = (number = 1, baseRevision = 5) => ({ version: "trip-api-v1", operation: "mutate",
  tripId: id, mutationId: `22222222-2222-4222-8222-${String(number).padStart(12, "0")}`, baseRevision,
  proposal: { tripId: id, baseRevision, summary: "予定を追加", patches: [{ type: "add", item: {
    id: `activity-${number}`, title: "散策", type: "activity", category: "free-time", schedule: { type: "unscheduled" },
  } }] } });
const setup = () => { const f = tripDynamoFixture(); f.seed(initial); return { ...f, application: new TripApplication(f.repository, f.repository, f.clock, { facts: async () => [] }) }; };

describe("atomic Trip mutation and idempotency", () => {
  it("keeps explicit lifecycle authority separate from model/HTTP proposal data", async () => {
    const f = setup(), r = request(), body = { ...r, proposal: { ...r.proposal,
      patches: [{ type: "lifecycle", state: "cancelled", basis: "user_confirmation" }] } };
    await expect(f.application.execute(owner, body)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.application.execute(owner, { ...body, confirmedLifecycle: "cancelled" })).rejects.toMatchObject({ code: "invalid-input" });
    expect(await f.application.execute(owner, body, { confirmedLifecycle: "cancelled" })).toMatchObject({ revision: 6, trip: { lifecycleState: "cancelled" } });
  });
  it("5+A→6, retry A→same 6, 5+B→conflict, different A→reject, 6+C→7", async () => {
    const f = setup(), a = request(), before = structuredClone(a);
    const result = await f.application.execute(owner, a);
    expect(result).toMatchObject({ revision: 6, mutationId: a.mutationId, trip: { schemaVersion: 2, revision: 6,
      createdAt: initial.createdAt, updatedAt: f.clock.now().toISOString(), items: [{ id: "activity-1" }] } });
    expect(await f.application.execute(owner, a)).toEqual(result);
    await expect(f.application.execute(owner, request(2))).rejects.toMatchObject({ code: "conflict" });
    await expect(f.application.execute(owner, { ...a, proposal: { ...a.proposal, summary: "different" } })).rejects.toMatchObject({ code: "mutation-reused" });
    expect(await f.application.execute(owner, request(3, 6))).toMatchObject({ revision: 7 });
    expect(await f.application.execute(owner, a)).toEqual(result); // Receipt is original result, not latest state.
    expect((await f.repository.get(owner, id))?.revision).toBe(7);
    expect((await f.repository.list(owner)).trips).toHaveLength(1); // Receipts are not Trip records.
    expect(f.commands.filter((c) => c instanceof TransactWriteItemsCommand)).toHaveLength(2);
    expect(a).toEqual(before);
  });
  it("CAS checks concurrent edits between read/validate and write atomically", async () => {
    const f = setup();
    const concurrent = { ...initial, revision: 6, title: "他の編集" };
    f.faults.beforeTransaction = () => f.seed(concurrent);
    await expect(f.application.execute(owner, request())).rejects.toMatchObject({ code: "conflict" });
    expect(await f.repository.get(owner, id)).toEqual(concurrent);
    expect([...f.records.keys()].filter((k) => k.includes("MUTATION#"))).toEqual([]);
  });
  it("concurrent duplicate requests commit exactly once", async () => {
    const f = setup();
    const results = await Promise.all([f.application.execute(owner, request()), f.application.execute(owner, request())]);
    expect(results[0]).toEqual(results[1]); expect((await f.repository.get(owner, id))?.items).toHaveLength(1);
  });
  it("recovers a committed transaction with a lost SDK/API response", async () => {
    const f = setup(); f.faults.lostResponse = true;
    const committed = await f.application.execute(owner, request());
    expect(await f.application.execute(owner, request())).toEqual(committed);
    expect((await f.repository.get(owner, id))?.revision).toBe(6);
  });
  it("upgrades old #388 envelopes conditionally without resetting their revision", async () => {
    const f = setup(); f.seed(initial, owner.subject, true);
    expect(await f.application.execute(owner, request())).toMatchObject({ revision: 6 });
    expect(f.records.get(`OWNER#${owner.subject}/TRIP#${id}`)?.revision?.N).toBe("6");
    const g = setup(); g.seed(initial, owner.subject, true);
    g.faults.beforeTransaction = () => g.seed({ ...initial, title: "legacy raced" }, owner.subject, true);
    await expect(g.application.execute(owner, request())).rejects.toMatchObject({ code: "conflict" });
  });
  it("rejects invalid/overflow/forged metadata and legacy replace before transaction", async () => {
    const f = setup(), r = request();
    for (const body of [
      request(1, Number.MAX_SAFE_INTEGER), { ...r, mutationId: "bad" }, { ...r, ownerId: "forged" },
      { ...r, updatedAt: "2099-01-01T00:00:00Z" }, { ...r, proposal: { ...r.proposal, baseRevision: 4 } },
      { ...r, proposal: { ...r.proposal, patches: [...r.proposal.patches, { type: "remove", itemId: "missing" }] } },
      { version: "trip-api-v1", operation: "replace", trip: initial },
    ]) await expect(f.application.execute(owner, body)).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.commands.some((c) => c instanceof TransactWriteItemsCommand)).toBe(false);
    expect(await f.repository.get(owner, id)).toEqual(initial);
  });
  it("keeps owner isolation, principal requirement and archived visibility including retries", async () => {
    const f = setup();
    await expect(f.application.execute(undefined, request())).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(f.application.execute(otherOwner, request())).rejects.toMatchObject({ code: "not-found" });
    await f.application.execute(owner, request()); await f.repository.archive(owner, id);
    await expect(f.application.execute(owner, request())).rejects.toMatchObject({ code: "not-found" });
    const g = setup(); g.faults.beforeTransaction = () => { g.records.get(`OWNER#${owner.subject}/TRIP#${id}`)!.archived = { BOOL: true }; };
    await expect(g.application.execute(owner, request())).rejects.toMatchObject({ code: "not-found" });
    expect([...g.records.keys()].some((k) => k.includes("MUTATION#"))).toBe(false);
  });
  it("keeps each receipt bounded and out of the Trip aggregate", async () => {
    const f = setup();
    for (let n = 1; n <= 8; n++) await f.application.execute(owner, request(n, 4 + n));
    const trips = [...f.records.values()].filter((r) => r.sk?.S?.startsWith("TRIP#"));
    expect(trips).toHaveLength(1); expect(Object.keys(trips[0]!)).not.toContain("mutations");
    const receipts = [...f.records.values()].filter((r) => r.sk?.S?.startsWith("MUTATION#"));
    expect(receipts).toHaveLength(8);
    for (const r of receipts) { expect(Buffer.byteLength(r.trip!.S!)).toBeLessThanOrEqual(256 * 1024); expect(r.digest?.S).toHaveLength(64); }
  });
  it("makes identical stable-ID create/import idempotent but never overwrites differing content", async () => {
    const f = tripDynamoFixture(), trip = { ...initial, revision: 0 };
    const results = await Promise.all([f.repository.create(owner, trip), f.repository.create(owner, trip)]);
    expect(results).toEqual([trip, trip]);
    await expect(f.repository.create(owner, { ...trip, title: "different" })).rejects.toMatchObject({ code: "already-exists" });
    expect(await f.repository.get(owner, id)).toEqual(trip);
    await expect(f.repository.create(owner, initial)).rejects.toMatchObject({ code: "invalid-input" });
  });
  it("returns HTTP 409 conflict with no private request/patch/principal in logs", async () => {
    const f = setup(), logs: unknown[] = [];
    const handler = createTripApiHandler(f.application, { authenticate: async () => owner, log: (fields) => { logs.push(fields); } });
    await f.application.execute(owner, request());
    const result = await handler({ requestContext: { http: { method: "POST" } }, body: JSON.stringify(request(2)) }, { awsRequestId: "req" });
    expect(result.statusCode).toBe(409); expect(JSON.parse(result.body)).toMatchObject({ error: "conflict" });
    expect(JSON.stringify(logs)).not.toMatch(/owner-A|activity|散策|patches|予定/);
  });
});
