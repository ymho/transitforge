import { decideNotification } from "@raiquora/trip/notification-policy";
import { notificationView, observationOrder, type NotificationCurrency, type TripNotification } from "@raiquora/trip/notification";
import type { Trip } from "@raiquora/trip/trip";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import { requireTripPrincipal, type TripPrincipal, type TripRepository } from "../ports/trip-repository.js";
import type { TripImpactRepository } from "../ports/trip-impact-routing.js";
import { notificationDeliveryPolicy, type NotificationDelivery, type NotificationMetrics, type NotificationRepository, type NotificationWork } from "../ports/notification.js";
import { TripResourceError } from "../contracts/trip-api.js";

export class NotificationApplication {
  constructor(private readonly repository: NotificationRepository, private readonly trips: TripRepository,
    private readonly clock: TripClock = { now: () => new Date() }) {}
  async list(principal: TripPrincipal, after?: string) {
    requireTripPrincipal(principal);
    const page = await this.repository.list(principal, after), notifications = [];
    for (const n of page.notifications) notifications.push(notificationView(n, await this.currency(principal, n)));
    return { notifications, ...(page.after ? { after: page.after } : {}) };
  }
  async read(principal: TripPrincipal, id: string, version: number) {
    requireTripPrincipal(principal); await this.repository.markRead(principal, id, version, this.clock.now().toISOString());
  }
  /** Bounded subject references, not filtering a global owner page (which could omit this Trip). */
  async forSubjects(principal: TripPrincipal, tripId: string, revision: number, subjects: readonly string[]) {
    requireTripPrincipal(principal);
    const views = [];
    for (const subject of [...new Set(subjects)].slice(0, 12)) {
      const e = await this.repository.episode(principal, tripId, revision, subject);
      if (!e?.latestNotificationId) continue;
      const n = await this.repository.get(principal, e.latestNotificationId);
      if (!n || n.tripId !== tripId || n.tripRevision !== revision || n.subjectKey !== subject) throw new TripResourceError("unavailable");
      views.push(notificationView(n, await this.currency(principal, n)));
    }
    return views;
  }
  async current(principal: TripPrincipal, n: TripNotification): Promise<boolean> {
    const trip = await this.trips.get(principal, n.tripId);
    if (!matches(trip, n)) return false;
    const [episode, observation] = await Promise.all([this.repository.episode(principal, n.tripId, n.tripRevision, n.subjectKey), this.repository.observation(principal, n.tripId, n.subjectKey)]);
    return !!episode && !!observation && episode.latestNotificationId === n.id && episode.latestImpactId === n.impactId &&
      observation.impactId === n.impactId && observation.tripRevision === n.tripRevision && observation.fresh &&
      observationOrder(observation) === episode.latestOrder && Date.parse(observation.observedAt) <= this.clock.now().getTime() &&
      this.clock.now().getTime() < Date.parse(observation.expiresAt) && (n.phase === "resolved" ? episode.state === "resolved" : episode.state === "open");
  }
  private async currency(p: TripPrincipal, n: TripNotification): Promise<NotificationCurrency> {
    if (!matches(await this.trips.get(p, n.tripId), n) || n.phase === "resolved" || n.status === "suppressed") return "historical";
    return await this.current(p, n) ? "current" : "unconfirmed";
  }
}
function matches(trip: Trip | undefined, n: TripNotification) {
  return !!trip && trip.revision === n.tripRevision && !["cancelled", "completed"].includes(trip.lifecycleState) && n.itemIds.every((id) => trip.items.some((i) => i.id === id));
}

/** One bounded internal host. Never called by the Agent or a public trigger. */
export class NotificationWorker {
  private readonly application: NotificationApplication;
  constructor(private readonly repository: NotificationRepository, private readonly trips: TripRepository, private readonly impacts: TripImpactRepository,
    private readonly channel: NotificationDelivery, private readonly hash: (value: string) => string, private readonly metrics: NotificationMetrics,
    private readonly clock: TripClock = { now: () => new Date() }) { this.application = new NotificationApplication(repository, trips, clock); }
  async poll(remainingMs: () => number = () => Infinity) {
    const keys = await this.repository.due(this.clock.now().getTime()); this.metrics.record("Due", keys.length);
    for (const key of keys) {
      if (remainingMs() < 30000) break;
      const work = await this.repository.claim(key, this.clock.now().getTime()); if (!work) continue;
      try {
        if (!work.kind || work.attempt > notificationDeliveryPolicy.maxAttempts) { await this.dead(work); continue; }
        if (work.kind === "signal") await this.decide(work); else await this.deliver(work);
      } catch (error) {
        // A new observation/another claimant may have superseded this lease. Its own task remains durable.
        if (error instanceof TripResourceError && error.code === "conflict") { this.metrics.record("Retry", 1); continue; }
        this.metrics.record("Failed", 1);
        if (work.attempt >= notificationDeliveryPolicy.maxAttempts) await this.dead(work);
        else { await this.repository.finish(work, "pending", this.clock.now().getTime()); this.metrics.record("Retry", 1); }
      }
    }
    this.metrics.record("PollSuccess", 1);
  }
  private async decide(work: NotificationWork) {
    const o = work.observation!; const principal = { subject: work.key.pk.slice(6) }; requireTripPrincipal(principal);
    const trip = await this.trips.get(principal, o.tripId);
    if (!trip || trip.revision !== o.tripRevision || ["cancelled", "completed"].includes(trip.lifecycleState)) {
      await this.repository.finish(work, "done", this.clock.now().getTime()); this.metrics.record("Suppress", 1); return;
    }
    const stored = await this.impacts.read(principal, o.tripId, o.impactId);
    if (!stored || !stored.matchesTripRevision) throw new TripResourceError("unavailable");
    const previous = await this.repository.episode(principal, trip.id, trip.revision, o.subjectKey);
    const decision = decideNotification(trip, stored.impact, o, previous, this.clock.now().toISOString(), this.hash);
    await this.repository.commitDecision(work, trip, previous, decision, this.clock.now().getTime());
    this.metrics.record("Decisions", 1);
    this.metrics.record(decision.action === "notify" ? "Notify" : decision.action === "suppress" ? "Suppress" : decision.action === "resolve" ? "Resolve" : "Unknown", 1);
    if (decision.reason === "duplicate") this.metrics.record("DuplicateSuppressed", 1);
    if (decision.reason === "risk-escalated") this.metrics.record("Escalated", 1);
    if (decision.notification) this.metrics.record("Queued", 1);
  }
  private async deliver(work: NotificationWork) {
    const principal = { subject: work.key.pk.slice(6) }; requireTripPrincipal(principal);
    const n = await this.repository.get(principal, work.notificationId!);
    if (!n) throw new TripResourceError("unavailable");
    if (["sent", "read", "suppressed"].includes(n.status)) { await this.repository.finish(work, "done", this.clock.now().getTime()); return; }
    if (!await this.application.current(principal, n)) {
      // Pending newer decision must run first. Retry rather than falsely asserting recovery.
      const o = await this.repository.observation(principal, n.tripId, n.subjectKey);
      const e = await this.repository.episode(principal, n.tripId, n.tripRevision, n.subjectKey);
      if (matches(await this.trips.get(principal, n.tripId), n) && o && e && o.tripRevision === n.tripRevision && observationOrder(o) > e.latestOrder && Date.parse(o.expiresAt) > this.clock.now().getTime()) throw new TripResourceError("unavailable");
      await this.repository.completeDelivery(work, n, "suppressed", this.clock.now().toISOString()); this.metrics.record("Suppress", 1); return;
    }
    const receipt = await this.channel.send(principal, n, n.dedupeKey);
    await this.repository.completeDelivery(work, n, receipt === "delivered" ? "sent" : "suppressed", this.clock.now().toISOString());
    this.metrics.record(receipt === "delivered" ? "Sent" : "Suppress", 1);
    this.metrics.record("DeliveryLatencyMs", Math.max(0, this.clock.now().getTime() - Date.parse(n.createdAt)));
  }
  private async dead(work: NotificationWork) {
    if (work.kind === "delivery" && work.notificationId) {
      const n = await this.repository.get({ subject: work.key.pk.slice(6) }, work.notificationId);
      if (n) { await this.repository.completeDelivery(work, n, "failed", this.clock.now().toISOString()); this.metrics.record("DLQ", 1); return; }
    }
    await this.repository.finish(work, "dead", this.clock.now().getTime()); this.metrics.record("DLQ", 1);
  }
}
