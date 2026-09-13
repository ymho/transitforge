import { diffTripWatches, projectTripWatches, watchSubjectKey } from "@raiquora/trip/trip-watch";
import { validateTravelEvent, type TravelEvent } from "@raiquora/trip/travel-event";
import { isCurrentTripImpact, type TripImpact } from "@raiquora/trip/trip-impact";
import { validateReservationFact } from "@raiquora/trip/reservation";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import { TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal, type TripRepository } from "../ports/trip-repository.js";
import type { TripWatchRepository } from "../ports/trip-watch-repository.js";
import type { TripImpactEvaluator, WatchScopeResolver, WatchReservationReader } from "../ports/trip-impact-evaluator.js";

/** Internal reconcile can be retried after a failed sync or lost response. #407 supplies durable triggers.
 * Never accepts a caller/LLM Trip snapshot as the authoritative source of Watch generation.
 */
export class TripWatchApplication {
  constructor(private readonly trips: TripRepository, private readonly watches: TripWatchRepository,
    private readonly scopes: WatchScopeResolver = { resolve: async () => [] }) {}

  async reconcile(principal: TripPrincipal, tripId: string) {
    requireTripPrincipal(principal); tripIdentifier(tripId);
    const trip = await this.trips.get(principal, tripId);
    const base = await this.watches.read(principal, tripId);
    // A missing/archived Trip can only deactivate already-owned watches. No new resource/existence leak.
    if (!trip && !base.version) throw new TripResourceError("not-found");
    const revision = trip?.revision ?? base.sourceTripRevision!;
    if (base.sourceTripRevision !== undefined && base.sourceTripRevision > revision) throw new TripResourceError("conflict");
    const desired = trip ? projectTripWatches(trip, await this.scopes.resolve(principal, structuredClone(trip))) : [];
    const diff = diffTripWatches(tripId, revision, base.records, desired);
    // Even a no-op recheck is guarded against a concurrent Trip archive/edit at commit.
    await this.watches.commit(principal, tripId, base, trip, diff.writes);
    return { sourceTripRevision: revision, changed: diff.writes.length, unchanged: diff.unchanged.length };
  }
}

export interface TripWatchWorkerResult {
  impacts: TripImpact[];
  skipped: { tripId: string; reason: "trip_unavailable" | "watch_stale" | "trip_changed" }[];
}
/** No queue/notification implementation. Internal subject routing (#394) derives owners from storage.
 * A stale watch is skipped (then reconciled by #407), never silently applied to a newer revision.
 */
export class TripWatchWorker {
  constructor(private readonly trips: TripRepository, private readonly watches: TripWatchRepository,
    private readonly evaluator: TripImpactEvaluator, private readonly reservations: WatchReservationReader,
    private readonly clock: TripClock = { now: () => new Date() }) {}
  async process(principal: TripPrincipal, input: TravelEvent): Promise<TripWatchWorkerResult> {
    requireTripPrincipal(principal); validateTravelEvent(input);
    const event = structuredClone(input), matches = await this.watches.find(principal, event.subject);
    const result: TripWatchWorkerResult = { impacts: [], skipped: [] };
    for (const tripId of new Set(matches.map((r) => r.watch.tripId))) {
      const trip = await this.trips.get(principal, tripId);
      if (!trip || trip.lifecycleState === "cancelled" || trip.lifecycleState === "completed") {
        result.skipped.push({ tripId, reason: "trip_unavailable" }); continue;
      }
      const records = matches.filter((r) => r.watch.tripId === tripId);
      if (records.some((r) => !r.active || r.watch.sourceTripRevision !== trip.revision ||
          !trip.items.some((item) => item.id === r.watch.itineraryItemId) || watchSubjectKey(r.watch.subject) !== watchSubjectKey(event.subject))) {
        result.skipped.push({ tripId, reason: "watch_stale" }); continue;
      }
      const reservations = await this.reservations.facts(principal, tripId);
      reservations.forEach(validateReservationFact); // Reader is already owner/Trip scoped; Fact intentionally omits private resource identity.
      const impact = await this.evaluator.evaluate({ trip: structuredClone(trip), event: structuredClone(event),
        watches: structuredClone(records.map((r) => r.watch)), reservations: structuredClone(reservations), evaluatedAt: this.clock.now().toISOString() });
      if (!isCurrentTripImpact(impact, trip, event)) throw new TripResourceError("invalid-input");
      const latest = await this.trips.get(principal, tripId);
      if (!latest || latest.revision !== trip.revision) { result.skipped.push({ tripId, reason: "trip_changed" }); continue; }
      result.impacts.push(structuredClone(impact));
    }
    return result; // #394/#395 must recheck revision at their persistence/delivery boundary too.
  }
}
