import { TripResourceError } from "../contracts/trip-api.js";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import { tripChangedDelivery, type TripChangedOutbox } from "../ports/trip-changed-outbox.js";
import type { TripWatchApplication } from "./trip-watch-application.js";

export type DeliveryMetric = "Received" | "DuplicateOrStale" | "ReconcileSuccess" | "ReconcileFailure" | "Retry" | "DLQ" | "ProjectionLagMs" | "PollSuccess";
export interface TripChangedMetrics { record(name: DeliveryMetric, value: number): void }
/** No signal snapshot, owner list, Watch projector or transaction implementation here. */
export class TripChangedConsumer {
  constructor(private readonly outbox: TripChangedOutbox, private readonly watches: Pick<TripWatchApplication, "reconcile">,
    private readonly metrics: TripChangedMetrics, private readonly clock: TripClock = { now: () => new Date() }) {}
  async poll(remainingMs: () => number = () => Infinity): Promise<void> {
    for (const key of await this.outbox.due(this.clock.now().getTime())) {
      // Never claim work we cannot start. Unclaimed records stay durable/indexed.
      if (remainingMs() < 15_000) break;
      this.metrics.record("Received", 1);
      const claim = await this.outbox.claim(key, this.clock.now().getTime());
      if (!claim) { this.metrics.record("DuplicateOrStale", 1); continue; }
      if (claim.attempt > 1) this.metrics.record("Retry", 1);
      if (!claim.event || claim.attempt > tripChangedDelivery.maxAttempts) {
        await this.outbox.finish(claim, "dead", this.clock.now().getTime()); this.metrics.record("DLQ", 1); continue;
      }
      try {
        const event = claim.event;
        try {
          const result = await this.watches.reconcile({ subject: event.ownerSubject }, event.tripId);
          if (result.sourceTripRevision > event.revision || result.changed === 0) this.metrics.record("DuplicateOrStale", 1);
        } catch (error) {
          // #393: not-found means BOTH Trip and any Watch collection are absent. Nothing to deactivate.
          if (!(error instanceof TripResourceError) || error.code !== "not-found") throw error;
          this.metrics.record("DuplicateOrStale", 1);
        }
        await this.outbox.finish(claim, "done", this.clock.now().getTime());
        this.metrics.record("ReconcileSuccess", 1);
        this.metrics.record("ProjectionLagMs", Math.max(0, this.clock.now().getTime() - Date.parse(event.changedAt)));
      } catch {
        this.metrics.record("ReconcileFailure", 1);
        const state = claim.attempt >= tripChangedDelivery.maxAttempts ? "dead" : "pending";
        // If this write fails, the persisted lease expires and the next tick retries. Never acknowledge failure.
        await this.outbox.finish(claim, state, this.clock.now().getTime());
        if (state === "dead") this.metrics.record("DLQ", 1);
      }
    }
    this.metrics.record("PollSuccess", 1);
  }
}
