import { parseTripCommand, TripResourceError, tripApiVersion } from "../contracts/trip-api.js";
import { requireTripPrincipal, type TripPrincipal, type TripRepository, type TripConversationReferences } from "../ports/trip-repository.js";
import { applyTripProposal, TripRevisionConflict } from "@raiquora/trip/trip";
import type { TripClock } from "@raiquora/trip/trip-temporal";
import type { LifecycleState } from "@raiquora/trip/trip-state";
import { bookedReservationChanges, reservationChangeKey } from "@raiquora/trip/reservation";
import type { ReservationReader } from "../ports/reservation-repository.js";
import type { TripFeasibilityReader } from "../ports/trip-feasibility-reader.js";
import { requireFeasibleTrip, requestsReady } from "@raiquora/trip/trip-ready";
import type { Trip } from "@raiquora/trip/trip";
import { assertItineraryEditingAllowed, previewInTripReplan, type InTripReplanTargets } from "@raiquora/trip/in-trip-replan";
import type { TripAuthorizer } from "../ports/trip-authorization.js";
import type { IntentProposalAdoptionPort } from "../ports/intent-proposal-adoption.js";

export class TripApplication {
  constructor(private readonly trips: TripRepository, private readonly references: TripConversationReferences,
    private readonly clock: TripClock = { now: () => new Date() }, private readonly reservations?: ReservationReader,
    private readonly feasibility?: TripFeasibilityReader, private readonly authorization?: TripAuthorizer,
    private readonly intentAdoptions?: IntentProposalAdoptionPort) {}
  private async ready(principal: TripPrincipal, proposed: Trip): Promise<void> {
    try {
      const reservations = await this.reservations?.facts(principal, proposed.id);
      const external = await this.feasibility?.external(principal, structuredClone(proposed));
      requireFeasibleTrip(proposed, { tripId: proposed.id, tripRevision: proposed.revision, reservations, external }, this.clock.now().toISOString());
    } catch { throw new TripResourceError("feasibility-required"); }
  }
  async execute(principal: TripPrincipal | undefined, value: unknown,
    authority: { confirmedLifecycle?: LifecycleState; confirmedAdoption?: string; confirmedReservationChange?: string;
      replanTargets?: InTripReplanTargets; confirmedReplan?: string } = {}): Promise<Record<string, unknown>> {
    requireTripPrincipal(principal);
    const actor = principal;
    const command = parseTripCommand(value);
    const access = this.authorization && ["get", "mutate", "archive"].includes(command.operation) && "tripId" in command
      ? await this.authorization.authorize(principal, command.tripId, command.operation === "get" ? "read" : command.operation === "mutate" ? "write" : "owner") : undefined;
    // Only this trusted result may resolve an owner namespace. Conversation operations stay personal.
    if (access) principal = access.owner;
    const version = tripApiVersion;
    switch (command.operation) {
      case "create": {
        if (command.trip.adoption !== undefined) throw new TripResourceError("confirmation-required");
        if (command.trip.planningState === "ready") await this.ready(principal, command.trip);
        return { version, trip: await this.trips.create(principal, command.trip) };
      }
      case "mutate": {
        const binding = command.proposal.intentBinding;
        if (binding && !this.intentAdoptions) throw new TripResourceError("unavailable");
        if (binding) {
          try { await this.intentAdoptions!.prepare(actor, { binding, tripId: command.tripId, baseTripRevision: command.baseRevision, mutationId: command.mutationId }); }
          catch (error) { throw new TripResourceError((error as { code?: string }).code === "conflict" ? "conflict" : "unavailable"); }
        }
        let trip: Trip;
        try { trip = await this.trips.applyMutation(principal, command, async (current) => {
          try { assertItineraryEditingAllowed(current, command.proposal); }
          catch { throw new TripResourceError("invalid-input"); }
          if (current.lifecycleState === "in_trip" && command.proposal.patches.some((p) => ["add", "replace", "remove", "move"].includes(p.type))) {
            const reservations = await this.reservations?.facts(principal, current.id);
            try {
              const preview = previewInTripReplan(current, command.proposal, { now: this.clock.now(), reservations,
                targets: authority.replanTargets });
              if (preview.confirmationKey && authority.confirmedReplan !== preview.confirmationKey) throw new TripResourceError("confirmation-required");
              // Re-evaluate against the post-Proposal itinerary, not the old scopes of external movement facts.
              await this.feasibility?.external(principal, preview.proposed).then((external) => {
                // Preview truth (including unknown) is retained; saving a draft is not ready certification.
                previewInTripReplan(current, command.proposal, { now: this.clock.now(), reservations, targets: authority.replanTargets, external });
              });
            } catch (error) {
              if (error instanceof TripResourceError) throw error;
              throw new TripResourceError(error instanceof TripRevisionConflict ? "conflict" : "invalid-input");
            }
          }
          if (command.proposal.patches.some((p) => p.type === "remove" || p.type === "replace")) {
            // A missing reader is unknown, not proof that no booking exists. Receipt retries skip preparation.
            if (!this.reservations) throw new TripResourceError("unavailable");
            const facts = await this.reservations.facts(principal, current.id);
            if (bookedReservationChanges(command.proposal, facts).length &&
                authority.confirmedReservationChange !== reservationChangeKey(command.proposal, facts)) throw new TripResourceError("confirmation-required");
          }
          // Explicit confirmation is supplied by a trusted host, never read from the DTO/LLM.
          let proposed: Trip;
          try { proposed = applyTripProposal(current, command.proposal, { clock: this.clock, ...authority }); }
          catch (error) { throw new TripResourceError(error instanceof TripRevisionConflict ? "conflict" : "invalid-input"); }
          if (requestsReady(command.proposal)) await this.ready(principal, proposed);
          return proposed; // Repository commits this exact preview under baseRevision CAS, not a rebase.
          }, access?.guard); }
        catch (error) {
          if (binding) {
            try { await this.intentAdoptions!.release(actor, { binding, tripId: command.tripId, baseTripRevision: command.baseRevision, mutationId: command.mutationId }); }
            catch { throw new TripResourceError("unavailable"); }
          }
          throw error;
        }
        if (binding) {
          try { await this.intentAdoptions!.complete(actor, { binding, tripId: command.tripId, baseTripRevision: command.baseRevision,
            committedTripRevision: trip.revision, mutationId: command.mutationId }); }
          catch { throw new TripResourceError("unavailable"); }
        }
        return { version, trip, revision: trip.revision, mutationId: command.mutationId };
      }
      case "get": {
        const trip = await this.trips.get(principal, command.tripId);
        if (!trip) throw new TripResourceError("not-found");
        return { version, trip, ...(access ? { role: access.role } : {}) };
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
