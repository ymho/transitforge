import type { Trip } from "@raiquora/trip/trip";
import { TripResourceError, type TripMutation } from "../contracts/trip-api.js";

/** Established by trusted server authentication, NOT HTTP body/headers or an Agent output. */
export interface TripPrincipal { readonly subject: string }
export function requireTripPrincipal(principal: TripPrincipal | undefined): asserts principal is TripPrincipal {
  if (!principal || typeof principal.subject !== "string" || !principal.subject.trim() || principal.subject.length > 200 || /[\u0000-\u001f\u007f]/.test(principal.subject)) throw new TripResourceError("unauthenticated");
}
export interface TripPage { trips: Trip[]; nextAfterTripId?: string }
/** Internal workers must also resolve an owner and use this same port. No scan/global lookup. */
export interface TripRepository {
  create(principal: TripPrincipal, trip: Trip): Promise<Trip>;
  get(principal: TripPrincipal, tripId: string): Promise<Trip | undefined>;
  list(principal: TripPrincipal, options?: { limit?: number; afterTripId?: string }): Promise<TripPage>;
  /** Calls the pure Application validator before any write; atomically commits Trip and retry receipt. */
  applyMutation(principal: TripPrincipal, mutation: TripMutation, prepare: (current: Trip) => Trip | Promise<Trip>): Promise<Trip>;
  archive(principal: TripPrincipal, tripId: string): Promise<void>;
}
/** Owner-scoped link index only; no conversation text, Trip ownership or reverse cascade. */
export interface TripConversationReferences {
  attach(principal: TripPrincipal, conversationId: string, tripId: string): Promise<void>;
  detach(principal: TripPrincipal, conversationId: string): Promise<void>;
  reference(principal: TripPrincipal, conversationId: string): Promise<string | undefined>;
}
