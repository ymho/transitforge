import { railTravelEvent } from "@raiquora/trip/travel-event-projection";
import { validateTravelEvent, type TravelEvent } from "@raiquora/trip/travel-event";
import type { RailImpactRouter, TripImpactRepository } from "../ports/rail-impact-routing.js";
import type { TripRepository } from "../ports/trip-repository.js";
import { TripResourceError } from "../contracts/trip-api.js";
import type { TripWatchWorker } from "./trip-watch-application.js";
import type { TripClock } from "@raiquora/trip/trip-temporal";

export type RailImpactMetric = "EventsReceived" | "RoutedOwners" | "RoutedTrips" | "Unknown" | "NoImpact" | "Impact" |
  "StaleRouting" | "StaleWatch" | "FanoutFailure" | "EvaluationFailure" | "PersistenceConflict" | "PersistenceFailure" | "FanoutLagMs" | "ReplayRequired";
export interface RailImpactMetrics { record(name: RailImpactMetric, value: number): void }
/** Trusted internal host seam. No owner argument, no public handler, no own Watch synchronization. */
export class RailImpactApplication {
  constructor(private readonly router: RailImpactRouter, private readonly worker: Pick<TripWatchWorker, "process">,
    private readonly trips: TripRepository, private readonly impacts: TripImpactRepository,
    private readonly metrics: RailImpactMetrics, private readonly clock: TripClock = { now: () => new Date() }) {}

  /** Original dated mapper remains the only operation snapshot -> Event conversion. */
  ingest(...input: Parameters<typeof railTravelEvent>) { return this.process(railTravelEvent(...input)); }

  async process(event: TravelEvent) {
    validateTravelEvent(event);
    if (event.kind !== "rail-operation") throw new TripResourceError("invalid-input");
    this.metrics.record("EventsReceived", 1);
    this.metrics.record("FanoutLagMs", Math.max(0, this.clock.now().getTime() - Date.parse(event.observedAt)));
    let routed;
    try { routed = await this.router.route(event.subject); }
    catch { this.metrics.record("FanoutFailure", 1); this.metrics.record("ReplayRequired", 1); throw new TripResourceError("unavailable"); }
    this.metrics.record("StaleRouting", routed.stale); this.metrics.record("RoutedTrips", routed.routes.length);
    const principals = [...new Map(routed.routes.map((r) => [r.principal.subject, r.principal])).values()];
    this.metrics.record("RoutedOwners", principals.length);
    let saved = 0, failed = 0, skipped = 0;
    for (const principal of principals) {
      let result;
      try { result = await this.worker.process(principal, structuredClone(event)); }
      catch { failed++; this.metrics.record("EvaluationFailure", 1); continue; }
      skipped += result.skipped.length;
      this.metrics.record("StaleWatch", result.skipped.length);
      for (const impact of result.impacts) {
        try {
          // Re-read immediately before the adapter's atomic Trip ConditionCheck + independent Impact Put.
          const trip = await this.trips.get(principal, impact.tripId);
          if (!trip || trip.revision !== impact.tripRevision) throw new TripResourceError("conflict");
          await this.impacts.save(principal, trip, impact);
          this.metrics.record(impact.status === "unknown" ? "Unknown" : impact.status === "no-impact" ? "NoImpact" : "Impact", 1); saved++;
        } catch (error) {
          failed++; this.metrics.record(error instanceof TripResourceError && error.code === "conflict" ? "PersistenceConflict" : "PersistenceFailure", 1);
        }
      }
    }
    // Even nonempty GSI results can omit recent watches. This receipt is NEVER a global safety certificate.
    // Hosts may replay the same event, or reingest a fresh observation with the existing stable Event identity.
    this.metrics.record("ReplayRequired", 1);
    return { saved, failed, skipped, routedTrips: routed.routes.length, routingCoverage: "eventual" as const, replayRequired: true as const };
  }
}
