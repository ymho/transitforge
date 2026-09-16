import { nextRecheckAt, recheckIdentity, recheckKind, recheckPolicyVersion } from "@raiquora/trip/trip-recheck";
import { watchSubjectKey } from "@raiquora/trip/trip-watch";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import { TripResourceError } from "../contracts/trip-api.js";
import { RecheckFailure, validateRecheckTask } from "../contracts/trip-recheck.js";
import { requireTripPrincipal, type TripPrincipal, type TripRepository } from "../ports/trip-repository.js";
import type { TripWatchRepository } from "../ports/trip-watch-repository.js";
import { recheckBackoff, recheckDelivery, type RecheckClaim, type RecheckEventSource, type RecheckMetrics,
  type RecheckScopeResolver, type TripRecheckRepository } from "../ports/trip-recheck.js";
import { TripWatchApplication } from "./trip-watch-application.js";
import type { TripImpactApplication } from "./trip-impact-application.js";

/** Decorates existing reconcile, not its projection/CAS/recovery algorithm. Outbox ACK follows BOTH durable writes. */
export class TripRecheckProjection {
  constructor(private readonly trips: TripRepository, private readonly watches: TripWatchRepository,
    private readonly tasks: TripRecheckRepository, private readonly scopes: RecheckScopeResolver,
    private readonly clock: TripClock = { now: () => new Date() }) {}
  async reconcile(principal: TripPrincipal, tripId: string) {
    let unresolved = false;
    const app = new TripWatchApplication(this.trips, this.watches, { resolve: async (_principal, trip) => {
      if (["cancelled", "completed"].includes(trip.lifecycleState)) return [];
      const result = await this.scopes.resolve(trip); unresolved = result.unresolved; return result.scopes;
    } });
    const result = await app.reconcile(principal, tripId);
    const trip = await this.trips.get(principal, tripId);
    if (!trip || ["cancelled", "completed"].includes(trip.lifecycleState)) return result;
    const collection = await this.watches.read(principal, tripId);
    if (!collection.complete || collection.sourceTripRevision !== trip.revision || result.sourceTripRevision !== trip.revision) throw new TripResourceError("conflict");
    for (const { watch, active } of collection.records) {
      if (!active) continue;
      const dueAt = nextRecheckAt(watch, this.clock.now().getTime());
      if (dueAt === undefined) continue;
      const kind = recheckKind(watch);
      await this.tasks.ensure(principal, { id: recheckIdentity(trip.id, trip.revision, kind, watch.id), tripId,
        sourceTripRevision: trip.revision, kind, watchId: watch.id, policyVersion: recheckPolicyVersion, dueAt });
    }
    if (unresolved) await this.tasks.ensure(principal, { id: recheckIdentity(trip.id, trip.revision, "readiness"), tripId,
      sourceTripRevision: trip.revision, kind: "readiness", policyVersion: recheckPolicyVersion, dueAt: this.clock.now().getTime() });
    return { ...result, unresolved };
  }
}

export class TripRecheckWorker {
  constructor(private readonly tasks: TripRecheckRepository, private readonly trips: TripRepository,
    private readonly watches: TripWatchRepository, private readonly projection: TripRecheckProjection,
    private readonly source: RecheckEventSource, private readonly impact: Pick<TripImpactApplication, "process">,
    private readonly metrics: RecheckMetrics, private readonly clock: TripClock = { now: () => new Date() }) {}
  async poll(remainingMs: () => number = () => Infinity): Promise<void> {
    const keys = await this.tasks.due(this.clock.now().getTime()); this.metrics.record("DueTasks", keys.length);
    for (const key of keys) {
      if (remainingMs() < 65_000) break;
      const claim = await this.tasks.claim(key, this.clock.now().getTime());
      if (!claim) continue;
      this.metrics.record("Claimed", 1);
      if (!claim.task || claim.attempt > recheckDelivery.maxAttempts) { await this.dead(claim); continue; }
      try { await this.execute(claim); }
      catch (error) {
        if (error instanceof RecheckFailure && error.code === "horizon") {
          await this.tasks.finish(claim, { state: "pending", dueAt: this.clock.now().getTime() + 3_600_000, attempt: 0, replay: 0, cycleStartedAt: 0 });
          continue; // No Provider IO occurred. A day without zone can enter its resolved local horizon later.
        }
        this.metrics.record("ProviderFailure", 1);
        if (error instanceof RecheckFailure) {
          if (error.code === "timeout") this.metrics.record("ProviderTimeout", 1);
          if (error.code === "rate_limited") this.metrics.record("ProviderRateLimit", 1);
          if (error.code === "target_unknown") this.metrics.record("TargetUnknown", 1);
        }
        if (claim.attempt >= recheckDelivery.maxAttempts || error instanceof RecheckFailure && error.code === "routing_lag" &&
            this.clock.now().getTime() - claim.cycleStartedAt >= recheckDelivery.replayWindowMs) await this.dead(claim);
        else {
          this.metrics.record("Retry", 1);
          await this.tasks.finish(claim, { state: "pending", dueAt: this.clock.now().getTime() + recheckBackoff(claim.attempt),
            attempt: claim.attempt, replay: claim.replay, cycleStartedAt: claim.cycleStartedAt });
        }
      }
    }
    this.metrics.record("PollSuccess", 1);
  }
  private async execute(claim: RecheckClaim) {
    const task = claim.task!; validateRecheckTask(task);
    // Key originated in the private due index and was verified on the base record. Task cannot assert owner.
    const principal = { subject: claim.key.pk.slice(6) }; requireTripPrincipal(principal);
    const trip = await this.trips.get(principal, task.tripId);
    if (!trip || trip.revision !== task.sourceTripRevision || ["cancelled", "completed"].includes(trip.lifecycleState)) {
      this.metrics.record("StaleRevisionSkip", 1); await this.tasks.finish(claim, { state: "inactive" }); return;
    }
    if (task.kind === "readiness") {
      const result = await this.projection.reconcile(principal, trip.id);
      if ("unresolved" in result && result.unresolved) throw new RecheckFailure("target_unknown");
      await this.tasks.finish(claim, { state: "inactive" }); return;
    }
    const collection = await this.watches.read(principal, trip.id);
    if (!collection.complete || collection.sourceTripRevision !== trip.revision) throw new RecheckFailure("unavailable");
    const watch = collection.records.find((r) => r.active && r.watch.id === task.watchId)?.watch;
    if (!watch || watch.sourceTripRevision !== trip.revision || recheckKind(watch) !== task.kind) {
      this.metrics.record("StaleRevisionSkip", 1); await this.tasks.finish(claim, { state: "inactive" }); return;
    }
    const now = this.clock.now().getTime(), due = nextRecheckAt(watch, now);
    if (due === undefined) { await this.tasks.finish(claim, { state: "inactive" }); return; }
    if (due > now) { await this.tasks.finish(claim, { state: "pending", dueAt: due, attempt: 0, replay: 0, cycleStartedAt: 0 }); return; }
    this.metrics.record("RecheckLagMs", Math.max(0, now - claim.dueAt));
    const events = await this.source.events(trip, watch, now);
    if (!events.length || events.length > 3 || events.some((event) => watchSubjectKey(event.subject) !== watchSubjectKey(watch.subject))) throw new RecheckFailure("invalid_response");
    this.metrics.record(events.every((event) => event.freshness === "fresh" && event.fact.status === "observed") ? "ProviderSuccess" : "ProviderFailure", 1);
    this.metrics.record("EventGenerated", events.length);
    // The trip may have changed while fetching. Don't dispatch stale scope to the shared fanout.
    const latest = await this.trips.get(principal, trip.id), active = await this.watches.read(principal, trip.id);
    if (!latest || latest.revision !== task.sourceTripRevision || ["cancelled", "completed"].includes(latest.lifecycleState) ||
        !active.complete || active.sourceTripRevision !== latest.revision || !active.records.some((r) => r.active && r.watch.id === watch.id)) {
      this.metrics.record("StaleRevisionSkip", 1); await this.tasks.finish(claim, { state: "inactive" }); return;
    }
    let empty = false;
    for (const event of events) {
      const receipt = await this.impact.process(event);
      this.metrics.record("ImpactSaved", receipt.saved);
      if (receipt.replayRequired) this.metrics.record("ReplayRequired", 1);
      if (receipt.failed) throw new RecheckFailure("unavailable");
      empty ||= receipt.routedTrips === 0 || receipt.saved === 0;
    }
    this.metrics.record("Executed", 1);
    if (claim.replay < recheckDelivery.replayPasses - 1) {
      await this.tasks.finish(claim, { state: "pending", dueAt: this.clock.now().getTime() + 60_000 * (claim.replay + 1),
        attempt: 0, replay: claim.replay + 1, cycleStartedAt: claim.cycleStartedAt }); return;
    }
    if (empty) throw new RecheckFailure("routing_lag");
    // This means a bounded replay pass succeeded, NOT globally complete GSI coverage.
    this.metrics.record("ReplaySuccess", 1);
    const next = nextRecheckAt(watch, this.clock.now().getTime(), true);
    await this.tasks.finish(claim, next === undefined ? { state: "inactive" } :
      { state: "pending", dueAt: next, attempt: 0, replay: 0, cycleStartedAt: 0 });
  }
  private async dead(claim: RecheckClaim) { await this.tasks.finish(claim, { state: "dead" }); this.metrics.record("DLQ", 1); }
}
