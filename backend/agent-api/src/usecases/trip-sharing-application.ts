import { canEditTrip, type ShareGrantView, type TripParticipantView } from "@raiquora/trip/trip-sharing";
import { TripResourceError, tripIdentifier } from "../contracts/trip-api.js";
import { parseSharingCommand, sharingVersion } from "../contracts/trip-sharing-api.js";
import { requireTripPrincipal, type TripPrincipal } from "../contracts/trip-principal.js";
import type { TripRepository } from "../ports/trip-repository.js";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import type { TripAuthorizer, TripAccess, TripSharingRepository, ShareSecret, ShareAbuseGuard, ShareGrant, TripParticipant } from "../ports/trip-authorization.js";
import type { ReservationReader } from "../ports/reservation-repository.js";
import { validateReservationFact } from "@raiquora/trip/reservation";

const denied = (): never => { throw new TripResourceError("not-found"); };
const grantView = (g: ShareGrant): ShareGrantView => ({ id: g.id, tripId: g.tripId, role: g.role, version: g.version,
  createdAt: g.createdAt, expiresAt: g.expiresAt, ...(g.revokedAt ? { revokedAt: g.revokedAt } : {}) });
const memberView = (m: TripParticipant): TripParticipantView => ({ id: m.id, tripId: m.tripId, role: m.role, version: m.version,
  active: m.active, joinedAt: m.joinedAt, updatedAt: m.updatedAt });

export class TripSharingApplication implements TripAuthorizer {
  constructor(private readonly trips: TripRepository, private readonly sharing: TripSharingRepository,
    private readonly secrets: ShareSecret, private readonly abuse: ShareAbuseGuard,
    private readonly clock: TripClock = { now: () => new Date() }, private readonly reservations?: ReservationReader) {}
  private validGrant(g: ShareGrant | undefined): g is ShareGrant {
    return !!g && !g.revokedAt && Date.parse(g.expiresAt) > this.clock.now().getTime();
  }
  async authorize(principal: TripPrincipal, tripId: string, required: "read" | "write" | "owner"): Promise<TripAccess> {
    requireTripPrincipal(principal); tripIdentifier(tripId);
    if (await this.trips.get(principal, tripId)) return { owner: principal, role: "owner" };
    const member = await this.sharing.participant(principal, tripId);
    if (!member?.active || required === "owner" || required === "write" && !canEditTrip(member.role)) return denied();
    const grant = await this.sharing.grant(member.grantId);
    if (!this.validGrant(grant) || grant.tripId !== tripId || grant.ownerSubject !== member.ownerSubject) return denied();
    const owner = { subject: member.ownerSubject };
    if (!await this.trips.get(owner, tripId)) return denied();
    return { owner, role: member.role, guard: { participant: member, grant } };
  }
  async execute(principal: TripPrincipal | undefined, value: unknown): Promise<Record<string, unknown>> {
    requireTripPrincipal(principal);
    // Rate limiting precedes parsing/verification for every share operation. No secret in limiter key.
    await this.abuse.consume(principal);
    const c = parseSharingCommand(value), now = this.clock.now().toISOString(), version = sharingVersion;
    if (c.operation === "accessible") {
      const page = await this.sharing.memberships(principal, c.afterTripId), trips = [];
      for (const member of page.members) {
        try {
          const access = await this.authorize(principal, member.tripId, "read");
          const trip = await this.trips.get(access.owner, member.tripId);
          if (trip) trips.push({ trip, role: access.role });
        } catch (error) { if (!(error instanceof TripResourceError) || error.code !== "not-found") throw error; }
      }
      return { version, trips, ...(page.after ? { afterTripId: page.after } : {}) };
    }
    if (c.operation === "redeem") {
      const grant = await this.sharing.grant(c.grantId);
      // Dummy hash check for an unknown grant as well; no distinguishable error category.
      const verified = this.secrets.verify(c.secret, grant?.secretHash ?? "0".repeat(64));
      if (!verified || !this.validGrant(grant) || grant.tripId !== c.tripId) return denied();
      const owner = { subject: grant.ownerSubject }, trip = await this.trips.get(owner, c.tripId);
      if (!trip) return denied();
      if (principal.subject === owner.subject) return { version, tripId: trip.id, role: "owner" };
      const old = await this.sharing.participant(principal, trip.id);
      if (old && old.ownerSubject !== owner.subject) return denied();
      if (old && !old.active && old.grantId === grant.id) return denied();
      if (old?.active && old.grantId === grant.id) return { version, tripId: trip.id, role: old.role };
      const member: TripParticipant = { id: old?.id ?? this.secrets.id(), tripId: trip.id, principalSubject: principal.subject,
        ownerSubject: owner.subject, grantId: grant.id, role: grant.role, version: (old?.version ?? -1) + 1,
        active: true, joinedAt: old?.joinedAt ?? now, updatedAt: now };
      await this.sharing.putParticipant(member, old, grant, trip);
      return { version, tripId: trip.id, role: member.role };
    }
    const access = await this.authorize(principal, c.tripId, c.operation === "reservation-facts" ? "read" : "owner");
    if (c.operation === "reservation-facts") {
      if (!this.reservations) throw new TripResourceError("unavailable");
      const facts = await this.reservations.facts(access.owner, c.tripId);
      facts.forEach(validateReservationFact);
      return { version, facts };
    }
    if (c.operation === "create-grant") {
      const expiresAt = c.expiresAt ?? new Date(this.clock.now().getTime() + 7 * 86400_000).toISOString();
      if (Date.parse(expiresAt) <= Date.parse(now) || Date.parse(expiresAt) > Date.parse(now) + 90 * 86400_000) throw new TripResourceError("invalid-input");
      const issued = this.secrets.issue();
      const grant: ShareGrant = { id: this.secrets.id(), tripId: c.tripId, ownerSubject: access.owner.subject, role: c.role,
        version: 0, secretHash: issued.hash, createdAt: now, expiresAt };
      const trip = await this.trips.get(access.owner, c.tripId); if (!trip) return denied();
      await this.sharing.createGrant(grant, trip);
      return { version, grant: grantView(grant), secret: issued.secret }; // Sole raw-secret response, no log/trace.
    }
    if (c.operation === "manage") {
      const page = await this.sharing.management(access.owner, c.tripId, c.after);
      return { version, participants: page.members.map(memberView), grants: page.grants.map(grantView), ...(page.after ? { after: page.after } : {}) };
    }
    if (c.operation === "revoke-grant") {
      const grant = await this.sharing.grant(c.grantId);
      if (!grant || grant.tripId !== c.tripId || grant.ownerSubject !== access.owner.subject) return denied();
      if (grant.revokedAt) return { version }; // Idempotent revoke, access remains denied.
      if (grant.version !== c.baseVersion) throw new TripResourceError("conflict");
      await this.sharing.replaceGrant(grant, { ...grant, version: grant.version + 1, revokedAt: now });
      return { version };
    }
    const member = await this.sharing.managedParticipant(access.owner, c.tripId, c.participantId);
    if (!member || member.ownerSubject !== access.owner.subject || member.tripId !== c.tripId) return denied();
    if (member.version !== c.baseVersion) throw new TripResourceError("conflict");
    await this.sharing.replaceParticipant(member, { ...member, role: c.role, active: c.active, version: member.version + 1, updatedAt: now });
    return { version };
  }
}
