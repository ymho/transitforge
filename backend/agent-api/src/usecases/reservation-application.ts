import { reservationFact, type Reservation } from "@raiquora/trip/reservation";
import { parseReservationCommand, boundedReservation, reservationApiVersion, type ReservationCommand } from "../contracts/reservation-api.js";
import { TripResourceError } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal, type TripRepository } from "../ports/trip-repository.js";
import type { ReservationRepository, ReservationReader } from "../ports/reservation-repository.js";
import type { ExternalSourceEvidence } from "@raiquora/trip/external-travel-information";
import { validatePlaceSource } from "@raiquora/trip/place-snapshot";

/** Trusted host only; never populated from HTTP body, Candidate or LLM output. */
export interface ReservationAuthority {
  confirmed: boolean;
  /** Fields confirmed as retainable by the booking/import boundary, including fixed booking times. */
  retainedFields?: readonly ("provider" | "providerItemId" | "bookedAt" | "startsAt" | "endsAt" | "bookingReference")[];
  /** Trusted import evidence, never a payload field. Public durable identity, not booking credentials. */
  providerEvidence?: ExternalSourceEvidence;
}
export class ReservationApplication implements ReservationReader {
  constructor(private readonly trips: Pick<TripRepository, "get">, private readonly reservations: ReservationRepository) {}
  private async trip(principal: TripPrincipal, tripId: string, itemId?: string) {
    requireTripPrincipal(principal);
    const trip = await this.trips.get(principal, tripId);
    if (!trip) throw new TripResourceError("not-found");
    if (itemId !== undefined && !trip.items.some((i) => i.id === itemId)) throw new TripResourceError("invalid-input");
    return trip;
  }
  async facts(principal: TripPrincipal, tripId: string) {
    await this.trip(principal, tripId);
    return (await this.reservations.list(principal, tripId)).map(reservationFact);
  }
  private async previewValue(principal: TripPrincipal, c: ReservationCommand): Promise<Reservation> {
    const tripId = c.operation === "create" ? c.reservation.tripId : c.tripId;
    await this.trip(principal, tripId);
    if (c.operation === "create") {
      await this.trip(principal, tripId, c.reservation.itineraryItemId);
      return boundedReservation(c.reservation);
    }
    if (c.operation === "get" || c.operation === "list") throw new TripResourceError("invalid-input");
    const before = await this.reservations.get(principal, tripId, c.reservationId);
    if (!before) throw new TripResourceError("not-found");
    if (before.revision !== c.baseRevision) throw new TripResourceError("conflict");
    let result = structuredClone(before);
    if (c.operation === "link") { await this.trip(principal, tripId, c.itineraryItemId); result = { ...result, itineraryItemId: c.itineraryItemId }; }
    if (c.operation === "unlink") { const { itineraryItemId: _, ...unlinked } = result; result = unlinked; }
    if (c.operation === "cancel") result = { ...result, status: "cancelled" };
    if (c.operation === "update") result = { id: before.id, tripId, schemaVersion: 1, revision: before.revision,
      ...(before.itineraryItemId ? { itineraryItemId: before.itineraryItemId } : {}), ...c.details };
    return boundedReservation(result);
  }
  async preview(principal: TripPrincipal | undefined, value: unknown) {
    requireTripPrincipal(principal);
    return { version: reservationApiVersion, reservation: reservationFact(await this.previewValue(principal, parseReservationCommand(value))), confirmationRequired: true };
  }
  async execute(principal: TripPrincipal | undefined, value: unknown, authority?: ReservationAuthority) {
    requireTripPrincipal(principal);
    const c = parseReservationCommand(value), version = reservationApiVersion;
    if (c.operation === "list") return { version, reservations: await this.facts(principal, c.tripId) };
    if (c.operation === "get") {
      await this.trip(principal, c.tripId);
      const r = await this.reservations.get(principal, c.tripId, c.reservationId!);
      if (!r) throw new TripResourceError("not-found");
      // Explicit owner-only detail read. Ordinary list/context reads use facts(), never this result.
      return { version, reservation: r };
    }
    if (authority?.confirmed !== true) throw new TripResourceError("confirmation-required");
    const next = await this.previewValue(principal, c);
    if (c.operation === "create" || c.operation === "update") {
      for (const key of ["provider", "providerItemId", "bookedAt", "startsAt", "endsAt", "bookingReference"] as const) {
        if (next[key] !== undefined && !authority.retainedFields?.includes(key)) throw new TripResourceError("invalid-input");
      }
      if (next.provider !== undefined) {
        try {
          const source = authority.providerEvidence;
          if (!source || source.provider !== next.provider || source.confidence !== "observed" ||
              next.providerItemId !== undefined && source.sourceId !== next.providerItemId) throw new Error();
          validatePlaceSource(source);
        } catch { throw new TripResourceError("invalid-input"); }
      }
    }
    const saved = c.operation === "create" ? await this.reservations.create(principal, next)
      : await this.reservations.replace(principal, next, c.baseRevision);
    return { version, reservation: reservationFact(saved), revision: saved.revision };
  }
}
