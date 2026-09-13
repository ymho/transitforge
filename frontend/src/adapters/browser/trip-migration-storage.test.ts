import { describe, expect, it, vi } from "vitest";
import type { Trip } from "@raiquora/trip/trip";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import { convertLegacyTripPlan } from "@raiquora/trip/legacy-trip-converter";
import { migrateTripToServer } from "../../usecases/trip-plan/trip-server-migration";
import { BrowserTripMigrationStore } from "./trip-migration-storage";
import { migrationLockFixture } from "./trip-migration-lock.fixture";
import { tripPlanStoreStorageKey, tripPlanStorageKey } from "../../usecases/trip-plan/trip-plan-repository";

const identity = { tripId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-09-13T01:00:00Z" };
const plan: TripPlan = { version: 1, id: "old", title: "旅", destination: "京都", updatedAt: "2026-09-01T01:00:00Z", items: [
  { id: "stay", type: "stay", destination: "京都", checkInDate: "2026-10-01", checkOutDate: "2026-10-02", options: [{ name: "選んでいない宿", checkInDate: "2026-10-01", checkOutDate: "2026-10-02" }] },
  { id: "spot", type: "sightseeing", place: { name: "未許諾施設", provider: "mapbox", placeId: "opaque" } },
] };
function fixture() {
  const original = JSON.stringify({ version: 2, plansBySessionId: { session: plan, invalid: { not: "a plan" } } });
  const values = new Map([[tripPlanStoreStorageKey, original]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const locks = migrationLockFixture(), store = new BrowserTripMigrationStore(storage, locks);
  let server: Trip | undefined;
  const client = { get: vi.fn(async () => server ? structuredClone(server) : undefined), create: vi.fn(async (trip: Trip) => { server = structuredClone(trip); return structuredClone(trip); }), attach: vi.fn(async () => {}), detach: vi.fn(async () => {}) };
  const options = { sessionId: "session", authenticatedScope: "owner-A", store, client, newIdentity: vi.fn(() => identity) };
  return { store, locks, values, original, options, client, storage, setServer: (trip?: Trip) => { server = trip; } };
}
describe("explicit legacy server migration", () => {
  it("serializes tabs, recovers the same stable target and reloads pending attempts", async () => {
    const f = fixture(); f.client.create.mockRejectedValueOnce(new Error("offline"));
    expect((await migrateTripToServer(f.options)).state).toBe("migration-pending");
    const tab = new BrowserTripMigrationStore(f.storage, f.locks);
    const identityBefore = tab.attempt("owner-A", "session");
    const result = await Promise.all([migrateTripToServer(f.options), migrateTripToServer({ ...f.options, store: tab })]);
    expect(result.map((r) => r.state)).toEqual(["server-v2", "server-v2"]);
    expect(tab.attempt("owner-A", "session")).toEqual(identityBefore);
    expect(f.options.newIdentity).toHaveBeenCalledOnce();
    expect(f.client.create).toHaveBeenCalledTimes(2); // failed attempt, then a single successful create
    expect(f.values.get(tripPlanStoreStorageKey)).toBe(f.original);
  });
  it("fails closed without a cross-tab lock instead of risking competing imports", async () => {
    const f = fixture(), store = new BrowserTripMigrationStore(f.storage, undefined);
    expect((await migrateTripToServer({ ...f.options, store })).state).toBe("migration-pending");
    expect(f.client.create).not.toHaveBeenCalled();
  });
  it("reuses the converter, preserves deferred/warning raw records and never fabricates evidence/time", async () => {
    const f = fixture(), result = await migrateTripToServer(f.options);
    expect(result.state).toBe("server-v2");
    expect(result.result).toEqual(convertLegacyTripPlan(plan, identity));
    expect(result.result?.requiresLegacyRetention).toBe(true);
    expect(result.result?.deferredItemIds).toContain("stay");
    expect(JSON.stringify(result.result?.trip)).not.toMatch(/選んでいない宿|未許諾施設|selectedAt|observedAt|retrievedAt|options/);
    expect(f.values.get(tripPlanStoreStorageKey)).toBe(f.original);
    expect(f.store.attempt("owner-A", "session")?.original).toBe(JSON.stringify(plan));
    expect(f.store.marker("owner-A", "session")).toEqual({ tripId: identity.tripId, verified: true });
    await migrateTripToServer(f.options);
    expect(f.client.create).toHaveBeenCalledTimes(1);
    expect(f.options.newIdentity).toHaveBeenCalledTimes(1);
  });
  it("no principal means no conversion/upload/marker", async () => {
    const f = fixture();
    expect(await migrateTripToServer({ ...f.options, authenticatedScope: undefined })).toEqual({ state: "legacy-only", error: "authentication-required" });
    expect(f.client.get).not.toHaveBeenCalled(); expect(f.options.newIdentity).not.toHaveBeenCalled(); expect(f.values.size).toBe(1);
  });
  it("failed upload is retryable with stable identity and no success marker", async () => {
    const f = fixture(); f.client.create.mockRejectedValueOnce(new Error("network"));
    expect((await migrateTripToServer(f.options)).state).toBe("migration-pending");
    expect(f.store.marker("owner-A", "session")).toBeUndefined();
    expect(f.values.get(tripPlanStoreStorageKey)).toBe(f.original);
    expect((await migrateTripToServer(f.options)).state).toBe("server-v2");
    expect(f.options.newIdentity).toHaveBeenCalledTimes(1);
  });
  it("requires read-back, repairs lost create response by GET and never blind-replaces", async () => {
    const f = fixture();
    f.client.create.mockImplementationOnce(async (trip) => { f.setServer(trip); throw new Error("response lost"); });
    expect((await migrateTripToServer(f.options)).error).toBe("unavailable");
    expect(f.store.marker("owner-A", "session")).toBeUndefined();
    expect((await migrateTripToServer(f.options)).state).toBe("server-v2");
    expect(f.client.create).toHaveBeenCalledTimes(1);
  });
  it("does not mark success from an upload acknowledgement without a matching read-back", async () => {
    const f = fixture(); f.client.create.mockImplementationOnce(async (trip) => trip);
    expect((await migrateTripToServer(f.options)).state).toBe("migration-pending");
    expect(f.store.marker("owner-A", "session")).toBeUndefined();
  });
  it("marker with missing server Trip blocks fallback and re-upload", async () => {
    const f = fixture(); await migrateTripToServer(f.options); f.setServer(undefined);
    expect(await migrateTripToServer(f.options)).toEqual({ state: "server-v2", tripId: identity.tripId, error: "server-missing" });
    expect(f.client.create).toHaveBeenCalledTimes(1);
  });
  it("detects changes in local input/server content and never overwrites either", async () => {
    const f = fixture(); f.client.create.mockRejectedValueOnce(new Error()); await migrateTripToServer(f.options);
    f.values.set(tripPlanStoreStorageKey, JSON.stringify({ version: 2, plansBySessionId: { session: { ...plan, title: "別内容" } } }));
    expect((await migrateTripToServer(f.options)).error).toBe("source-changed");
    const g = fixture(); g.setServer({ ...convertLegacyTripPlan(plan, identity).trip, title: "server edited" });
    expect((await migrateTripToServer(g.options)).state).toBe("migration-pending"); expect(g.client.create).not.toHaveBeenCalled();
  });
  it("attach failure keeps verified marker/server ownership and retries only the link", async () => {
    const f = fixture(); f.client.attach.mockRejectedValueOnce(new Error());
    expect(await migrateTripToServer(f.options)).toMatchObject({ state: "server-v2", tripId: identity.tripId, error: "unavailable" });
    expect((await migrateTripToServer(f.options)).state).toBe("server-v2"); expect(f.client.create).toHaveBeenCalledTimes(1);
  });
  it("quota failure does not report success or erase original; metadata is account scoped", async () => {
    const f = fixture(); const save = f.storage.setItem;
    vi.spyOn(f.storage, "setItem").mockImplementation((key, value) => { if (key.endsWith(":success")) throw new Error("quota"); save(key, value); });
    expect((await migrateTripToServer(f.options)).state).toBe("migration-pending");
    expect(f.values.get(tripPlanStoreStorageKey)).toBe(f.original);
    expect(f.store.attempt("owner-B", "session")).toBeUndefined();
  });
  it("reads the legacy single record without removing it and retains name-only manual data", async () => {
    const f = fixture(); f.values.delete(tripPlanStoreStorageKey);
    const manual = { ...plan, items: [{ id: "m", type: "sightseeing", place: { provider: "manual", name: "散策" } }] };
    f.values.set(tripPlanStorageKey, JSON.stringify(manual));
    const result = await migrateTripToServer(f.options);
    expect(result.result?.trip.items[0]).toMatchObject({ place: { name: "散策" } });
    expect(f.values.get(tripPlanStorageKey)).toBe(JSON.stringify(manual));
  });
});
