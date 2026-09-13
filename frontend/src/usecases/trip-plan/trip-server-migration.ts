import { convertLegacyTripPlan, type TripMigrationResult, type LegacyTripMigrationOptions } from "@raiquora/trip/legacy-trip-converter";
import { validateTrip, type Trip } from "@raiquora/trip/trip";
import type { TripPlan } from "@raiquora/trip/trip-plan";
import type { ServerTripClient, TripSourceState } from "./server-trip-client";

export interface LegacyMigrationInput { plan: TripPlan; original: string; options?: LegacyTripMigrationOptions }
export interface TripMigrationAttempt { tripId: string; createdAt: string; original: string }
export interface TripMigrationMarker { tripId: string; verified: true }
/** Local recovery metadata, owner/session scoped; never stores a second authoritative V2 Trip. */
export interface TripMigrationStore {
  readLegacy(sessionId: string): LegacyMigrationInput | undefined;
  attempt(scope: string, sessionId: string): TripMigrationAttempt | undefined;
  retain(scope: string, sessionId: string, attempt: TripMigrationAttempt): void;
  marker(scope: string, sessionId: string): TripMigrationMarker | undefined;
  mark(scope: string, sessionId: string, marker: TripMigrationMarker): void;
}
export type TripMigrationOutcome = { state: TripSourceState; result?: TripMigrationResult; tripId?: string; error?: "authentication-required" | "legacy-missing" | "source-changed" | "unavailable" | "server-missing" };

/** Explicit, gated import foundation. Caller must obtain authenticated transport and user consent.
 * scope is a local authenticated-account namespace, NOT an authorization claim sent to the server.
 * #389 will add server idempotency/CAS; this protocol never retries a blind overwrite.
 */
export async function migrateTripToServer(options: {
  sessionId: string; authenticatedScope?: string; store: TripMigrationStore; client: ServerTripClient;
  newIdentity(): { tripId: string; createdAt: string };
}): Promise<TripMigrationOutcome> {
  const { sessionId, store, client } = options, scope = options.authenticatedScope;
  if (!scope?.trim()) return { state: "legacy-only", error: "authentication-required" };
  let committed = false;
  let verifiedTripId: string | undefined;
  try {
    const marker = store.marker(scope, sessionId);
    if (marker) {
      committed = true;
      verifiedTripId = marker.tripId;
      const trip = await client.get(marker.tripId);
      if (!trip || trip.id !== marker.tripId) return { state: "server-v2", tripId: marker.tripId, error: "server-missing" };
      validateTrip(trip);
      await client.attach(sessionId, trip.id);
      return { state: "server-v2", tripId: trip.id };
    }
    const legacy = store.readLegacy(sessionId);
    if (!legacy) return { state: "migration-pending", error: "legacy-missing" };
    let attempt = store.attempt(scope, sessionId);
    if (attempt && attempt.original !== legacy.original) return { state: "migration-pending", error: "source-changed" };
    if (!attempt) {
      attempt = { ...options.newIdentity(), original: legacy.original };
      store.retain(scope, sessionId, attempt); // Preserve raw and stable target BEFORE any network write.
    }
    const result = convertLegacyTripPlan(legacy.plan, attempt, legacy.options);
    let stored = await client.get(attempt.tripId);
    if (!stored) {
      await client.create(result.trip);
      stored = await client.get(attempt.tripId);
    }
    // A lost response may be recovered by GET; do not overwrite an independently changed server record.
    if (!stored || !sameTrip(stored, result.trip)) return { state: "migration-pending", result, error: "unavailable" };
    if (store.readLegacy(sessionId)?.original !== attempt.original) return { state: "migration-pending", result, error: "source-changed" };
    store.mark(scope, sessionId, { tripId: stored.id, verified: true });
    committed = true;
    verifiedTripId = stored.id;
    // If attach fails the verified marker lets a later call retry without repeating import.
    await client.attach(sessionId, stored.id);
    return { state: "server-v2", tripId: stored.id, result };
  } catch { return { state: committed ? "server-v2" : "migration-pending", ...(verifiedTripId ? { tripId: verifiedTripId } : {}), error: "unavailable" }; }
}
function sameTrip(a: Trip, b: Trip): boolean {
  validateTrip(a); validateTrip(b);
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)])) : value;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
