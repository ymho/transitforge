import { parseTripCommand, TripResourceError, tripApiVersion } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal, type TripRepository, type TripConversationReferences } from "../ports/trip-repository.js";
import { applyTripProposal, TripRevisionConflict } from "@raiquora/trip/trip";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import type { LifecycleState } from "@raiquora/trip/trip-state";
import { bookedReservationChanges, reservationChangeKey } from "@raiquora/trip/reservation";
import type { ReservationReader } from "../ports/reservation-repository.js";

export class TripApplication {
  constructor(private readonly trips: TripRepository, private readonly references: TripConversationReferences,
    private readonly clock: TripClock = { now: () => new Date() }, private readonly reservations?: ReservationReader) {}
  async execute(principal: TripPrincipal | undefined, value: unknown,
    authority: { confirmedLifecycle?: LifecycleState; confirmedReservationChange?: string } = {}): Promise<Record<string, unknown>> {
    requireTripPrincipal(principal);
    const command = parseTripCommand(value);
    const version = tripApiVersion;
    switch (command.operation) {
      case "create": return { version, trip: await this.trips.create(principal, command.trip) };
      case "mutate": {
        const trip = await this.trips.applyMutation(principal, command, async (current) => {
          if (command.proposal.patches.some((p) => p.type === "remove" || p.type === "replace")) {
            // A missing reader is unknown, not proof that no booking exists. Receipt retries skip preparation.
            if (!this.reservations) throw new TripResourceError("unavailable");
            const facts = await this.reservations.facts(principal, current.id);
            if (bookedReservationChanges(command.proposal, facts).length &&
                authority.confirmedReservationChange !== reservationChangeKey(command.proposal, facts)) throw new TripResourceError("confirmation-required");
          }
          // Explicit confirmation is supplied by a trusted host, never read from the DTO/LLM.
          try { return applyTripProposal(current, command.proposal, { clock: this.clock, ...authority }); }
          catch (error) { throw new TripResourceError(error instanceof TripRevisionConflict ? "conflict" : "invalid-input"); }
        });
        return { version, trip, revision: trip.revision, mutationId: command.mutationId };
      }
      case "get": {
        const trip = await this.trips.get(principal, command.tripId);
        if (!trip) throw new TripResourceError("not-found");
        return { version, trip };
      }
      case "list": return { version, ...await this.trips.list(principal, command) };
      case "archive": await this.trips.archive(principal, command.tripId); return { version };
      case "attach":
        if (!await this.trips.get(principal, command.tripId)) throw new TripResourceError("not-found");
        await this.references.attach(principal, command.conversationId, command.tripId);
        return { version, tripId: command.tripId };
      case "detach": await this.references.detach(principal, command.conversationId); return { version };
      case "reference": return { version, tripId: await this.references.reference(principal, command.conversationId) };
    }
  }
}
