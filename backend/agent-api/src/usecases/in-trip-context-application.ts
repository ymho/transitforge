import { buildInTripContext, type InTripFacts } from "@raiquora/trip/in-trip-context";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import type { ZonedInstant } from "@raiquora/trip/itinerary-schedule";
import { requireTripPrincipal, type TripPrincipal, type TripRepository } from "../ports/trip-repository.js";
import type { TripImpactRepository } from "../ports/trip-impact-routing.js";
import type { TripObservationReader } from "../ports/in-trip-context.js";
import type { ReservationReader } from "../ports/reservation-repository.js";
import type { NotificationApplication } from "./notification-application.js";
import { TripResourceError, tripIdentifier } from "../contracts/trip-api.js";

/** Request-local owner-scoped read only. No provider calls, mutation, location collection or logging. */
export class InTripContextApplication {
  constructor(private readonly trips: Pick<TripRepository, "get">, private readonly observations: TripObservationReader,
    private readonly impacts: Pick<TripImpactRepository, "read">, private readonly reservations: ReservationReader,
    private readonly notifications: Pick<NotificationApplication, "forSubjects">,
    private readonly clock: TripClock = { now: () => new Date() }) {}
  async read(principal: TripPrincipal, tripId: string) {
    requireTripPrincipal(principal); tripIdentifier(tripId);
    const trip = await this.trips.get(principal, tripId);
    if (!trip) throw new TripResourceError("not-found");
    if (trip.lifecycleState !== "in_trip") return undefined;
    const now: ZonedInstant = { at: this.clock.now().toISOString(), timeZone: "UTC" };
    const facts: InTripFacts = { unavailable: [] };
    const failures: ("impacts" | "notifications" | "reservations")[] = [];
    await Promise.all([
      (async () => { try { facts.reservations = await this.reservations.facts(principal, tripId); }
        catch { failures.push("reservations"); } })(),
      (async () => {
        try {
          const page = await this.observations.observations(principal, tripId);
          if (page.observations.length > 12) throw new Error("Unbounded read");
          facts.impactTruncated = page.truncated; facts.notificationTruncated = page.truncated;
          const current = page.observations.filter((o) => o.tripRevision === trip.revision && o.tripId === tripId);
          await Promise.all([
            (async () => {
              try {
                facts.impacts = [];
                for (const o of current) {
                  const stored = await this.impacts.read(principal, tripId, o.impactId);
                  if (!stored?.matchesTripRevision) throw new Error("Unconfirmed impact");
                  facts.impacts.push({ impact: stored.impact, observedAt: o.observedAt, expiresAt: o.expiresAt, fresh: o.fresh });
                }
              } catch { facts.impacts = undefined; failures.push("impacts"); }
            })(),
            (async () => { try { facts.notifications = await this.notifications.forSubjects(principal, tripId, trip.revision, current.map((o) => o.subjectKey)); }
              catch { failures.push("notifications"); } })(),
          ]);
          // Recheck after BOTH Impact and Notification reads; do not mix an older Impact with a newer warning.
          const checked = await this.observations.observations(principal, tripId);
          if (JSON.stringify(checked) !== JSON.stringify(page)) throw new Error("Observation changed");
        } catch { failures.push("impacts", "notifications"); }
      })(),
    ]);
    // Prevent mixing results from a concurrent edit/archive with the earlier itinerary (including old envelopes).
    const latest = await this.trips.get(principal, tripId);
    if (JSON.stringify(latest) !== JSON.stringify(trip)) throw new TripResourceError("conflict");
    return buildInTripContext(trip, now, { ...facts, tripConfirmed: true, unavailable: failures });
  }
}
