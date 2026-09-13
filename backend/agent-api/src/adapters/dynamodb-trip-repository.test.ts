import { describe, expect, it } from "vitest";
import { createTrip } from "@raiquora/trip/trip";
import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { selectRailJourney, projectRailSchedule, revalidateSelectedRailJourney } from "@raiquora/trip/selected-rail-journey";
import { DynamoDbTripRepository } from "./dynamodb-trip-repository.js";
import { tripDynamoFixture } from "./trip-dynamodb.fixture.js";
import { TripApplication } from "../usecases/trip-application.js";
import type { TripMutation } from "../contracts/trip-api.js";

const a = { subject: "owner-A" }, b = { subject: "owner-B" };
const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const trip = () => createTrip(id, "旅行", "2026-09-13T01:00:00Z");
function fixture() { const f = tripDynamoFixture(); return { ...f, application: new TripApplication(f.repository, f.repository, f.clock, { facts: async () => [] }) }; }
const mutation = (tripId = id): TripMutation => ({ tripId, baseRevision: 0, mutationId: other, proposal: { tripId, baseRevision: 0, summary: "編集", patches: [] } });

describe("owner-scoped Trip storage", () => {
  it("persists a complete scheduled rail snapshot without leaking candidate realtime fields", async () => {
    const f = fixture(), { candidate, inputs, selectedAt } = railSelectionFixture();
    const journey = selectRailJourney(candidate, inputs, selectedAt);
    const input = createTrip(id, "鉄道の旅", "2026-09-13T01:00:00Z", [{ id: "rail", type: "transport", title: "移動", schedule: projectRailSchedule(journey), detail: { mode: "rail", status: "selected", journey } }]);
    await f.repository.create(a, input);
    const loaded = await f.repository.get(a, id);
    expect(loaded).toEqual(input);
    expect(JSON.stringify(loaded)).not.toMatch(/delayMinutes|congestion|realtimeStatus/);
    inputs[0]!.evidence.retrievedAt = "2026-09-14T08:00:00Z";
    expect(revalidateSelectedRailJourney(journey, inputs)).toBe(true);
    const invalid = structuredClone(input);
    Object.assign(invalid.items[0]!, { rawProvider: { delayMinutes: 10 } });
    await expect(f.repository.applyMutation(a, mutation(), () => invalid)).rejects.toMatchObject({ code: "invalid-input" });
    expect(await f.repository.get(a, id)).toEqual(input);
  });
  it("round trips schema/revision, copies input and replaces only an existing active resource", async () => {
    const f = fixture(), input = trip();
    expect(await f.repository.create(a, input)).toEqual(input);
    expect(await f.repository.get(a, id)).toEqual(input);
    expect(await f.repository.create(a, input)).toEqual(input);
    const replacement = { ...input, title: "変更" };
    await f.repository.applyMutation(a, mutation(), () => replacement);
    expect(await f.repository.get(a, id)).toEqual({ ...replacement, revision: 1, updatedAt: f.clock.now().toISOString() });
    expect(input).toEqual(trip());
    await expect(f.repository.applyMutation(a, mutation(other), () => ({ ...replacement, id: other }))).rejects.toMatchObject({ code: "not-found" });
    await expect(f.repository.applyMutation(a, { ...mutation(), baseRevision: 1, mutationId: id, proposal: { ...mutation().proposal, baseRevision: 1 } }, () => ({ ...replacement, revision: 1, createdAt: "2026-09-12T01:00:00Z" }))).rejects.toMatchObject({ code: "invalid-input" });
  });
  it("scopes reads, lists, replace, archive and link references to owner keys", async () => {
    const f = fixture(); await f.repository.create(a, trip());
    expect(await f.repository.get(b, id)).toBeUndefined();
    expect((await f.repository.list(b)).trips).toEqual([]);
    expect((await f.repository.list(a)).trips).toHaveLength(1);
    await expect(f.repository.applyMutation(b, mutation(), () => trip())).rejects.toMatchObject({ code: "not-found" });
    await expect(f.repository.archive(b, id)).rejects.toMatchObject({ code: "not-found" });
    await expect(f.repository.attach(b, "session", id)).rejects.toMatchObject({ code: "not-found" });
    await f.repository.create(b, trip()); // Same opaque Trip ID in another owner namespace remains isolated.
    await f.repository.archive(b, id);
    expect(await f.repository.get(a, id)).toBeDefined();
  });
  it("archive preserves Trip data and links, hides reads/lists, and never revives via replace", async () => {
    const f = fixture(); await f.repository.create(a, trip());
    await f.repository.attach(a, "first", id); await f.repository.attach(a, "second", id);
    expect(await f.repository.reference(b, "first")).toBeUndefined();
    await f.repository.detach(a, "first");
    expect(await f.repository.get(a, id)).toBeDefined();
    await f.repository.archive(a, id);
    expect(await f.repository.get(a, id)).toBeUndefined(); expect((await f.repository.list(a)).trips).toEqual([]);
    expect(await f.repository.reference(a, "second")).toBe(id);
    expect(f.records.get(`OWNER#owner-A/TRIP#${id}`)?.trip?.S).toContain('"schemaVersion":2');
    await expect(f.repository.applyMutation(a, mutation(), () => trip())).rejects.toMatchObject({ code: "not-found" });
  });
  it("paginates within the owner even across an archived page", async () => {
    const f = fixture(); await f.repository.create(a, trip()); await f.repository.create(a, { ...trip(), id: other });
    await f.repository.archive(a, id);
    const first = await f.repository.list(a, { limit: 1 });
    expect(first).toEqual({ trips: [], nextAfterTripId: id });
    expect((await f.repository.list(a, { afterTripId: first.nextAfterTripId, limit: 1 })).trips[0]?.id).toBe(other);
  });
  it("requires principal on every repository operation before issuing commands", async () => {
    const f = fixture(), missing = undefined as never;
    for (const promise of [f.repository.create(missing, trip()), f.repository.get(missing, id), f.repository.list(missing), f.repository.applyMutation(missing, mutation(), () => trip()), f.repository.archive(missing, id), f.repository.attach(missing, "s", id), f.repository.detach(missing, "s"), f.repository.reference(missing, "s")]) await expect(promise).rejects.toMatchObject({ code: "unauthenticated" });
    expect(f.commands).toEqual([]);
  });
  it("rejects invalid Domain, raw payload and forged request owner without writes", async () => {
    const f = fixture();
    for (const input of [{ ...trip(), schemaVersion: 1 }, { ...trip(), candidates: [] }, { ...trip(), items: [{ id: "bad", type: "unknown" }] }]) await expect(f.repository.create(a, input as never)).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.application.execute(a, { version: "trip-api-v1", operation: "create", trip: trip(), ownerId: "owner-B" })).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.commands).toEqual([]);
  });
  it("Application maps cross-owner to the same not-found as an unknown resource", async () => {
    const f = fixture(); await f.repository.create(a, trip());
    for (const tripId of [id, other]) await expect(f.application.execute(b, { version: "trip-api-v1", operation: "get", tripId })).rejects.toMatchObject({ code: "not-found" });
  });
  it("does not expose SDK errors or accept corrupt storage as a normal Trip", async () => {
    const repository = new DynamoDbTripRepository("t", { send: async () => { throw new Error("private-party-and-token"); } });
    await expect(repository.get(a, id)).rejects.toMatchObject({ message: "unavailable" });
    const f = fixture(); await f.repository.create(a, trip());
    f.records.get(`OWNER#owner-A/TRIP#${id}`)!.storageVersion = { N: "999" };
    await expect(f.repository.get(a, id)).rejects.toMatchObject({ code: "unavailable" });
  });
});
