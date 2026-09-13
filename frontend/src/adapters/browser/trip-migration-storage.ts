import type { TripMigrationStore, TripMigrationAttempt, TripMigrationMarker } from "../../usecases/trip-plan/trip-server-migration";
import { parseTripPlan, tripPlanStorageKey, tripPlanStoreStorageKey } from "../../usecases/trip-plan/trip-plan-repository";

/** Never deletes the source keys or backups, including after success, detach or conversation eviction. */
export class BrowserTripMigrationStore implements TripMigrationStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly locks: Pick<LockManager, "request"> | undefined = globalThis.navigator?.locks) {}
  async exclusive<T>(scope: string, sessionId: string, work: () => Promise<T>): Promise<T> {
    // Fail closed without cross-tab exclusion; never substitute a process-local lock.
    if (!this.locks) throw new Error("Exclusive import is unavailable");
    return this.locks.request(this.key(scope, sessionId, "lock"), { mode: "exclusive" }, work);
  }
  private key(scope: string, sessionId: string, kind: string): string {
    if (!scope.trim() || scope.length > 200 || !/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) throw new Error("Invalid migration scope");
    return `transitforge.trip-import.v1:${encodeURIComponent(scope)}:${sessionId}:${kind}`;
  }
  readLegacy(sessionId: string) {
    const storeRaw = this.storage.getItem(tripPlanStoreStorageKey);
    const singleRaw = this.storage.getItem(tripPlanStorageKey);
    if (!storeRaw && !singleRaw) return undefined;
    // Parse a single record independently; another invalid record must not discard this Trip.
    const store = storeRaw ? JSON.parse(storeRaw) : undefined;
    if (storeRaw && (store?.version !== 2 || !Object.hasOwn(store.plansBySessionId ?? {}, sessionId))) return undefined;
    const raw = store?.version === 2 && Object.hasOwn(store.plansBySessionId ?? {}, sessionId)
      ? JSON.stringify(store.plansBySessionId[sessionId]) : singleRaw;
    if (!raw) return undefined;
    const plan = parseTripPlan(JSON.parse(raw));
    if (!plan) throw new Error("Invalid legacy Trip");
    return { plan, original: raw };
  }
  attempt(scope: string, sessionId: string): TripMigrationAttempt | undefined {
    const raw = this.storage.getItem(this.key(scope, sessionId, "attempt"));
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (!validId(value.tripId) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.original !== "string") throw new Error("Invalid migration attempt");
    return { tripId: value.tripId, createdAt: value.createdAt, original: value.original };
  }
  retain(scope: string, sessionId: string, attempt: TripMigrationAttempt): void {
    const key = this.key(scope, sessionId, "attempt");
    if (this.storage.getItem(key)) throw new Error("Migration attempt already retained");
    this.storage.setItem(key, JSON.stringify(attempt));
  }
  marker(scope: string, sessionId: string): TripMigrationMarker | undefined {
    const raw = this.storage.getItem(this.key(scope, sessionId, "success"));
    if (!raw) return undefined;
    const value = JSON.parse(raw);
    if (!validId(value.tripId) || value.verified !== true) throw new Error("Invalid migration marker");
    return { tripId: value.tripId, verified: true };
  }
  mark(scope: string, sessionId: string, marker: TripMigrationMarker): void {
    this.storage.setItem(this.key(scope, sessionId, "success"), JSON.stringify(marker));
  }
}
function validId(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value); }
