import type { IntentProposalBinding } from "@raiquora/trip/intent-proposal-binding";
import type { TripPrincipal } from "./trip-repository.js";

export interface IntentProposalAdoptionPort {
  prepare(principal: TripPrincipal, input: { binding: IntentProposalBinding; tripId: string; baseTripRevision: number; mutationId: string }): Promise<void>;
  complete(principal: TripPrincipal, input: { binding: IntentProposalBinding; tripId: string; baseTripRevision: number; committedTripRevision: number; mutationId: string }): Promise<void>;
  release(principal: TripPrincipal, input: { binding: IntentProposalBinding; tripId: string; baseTripRevision: number; mutationId: string }): Promise<void>;
}
