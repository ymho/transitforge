import type { Trip } from "@raiquora/trip/trip";
import type { TripRole, ShareGrantView, TripParticipantView } from "@raiquora/trip/trip-sharing";
import type { TripPrincipal } from "../contracts/trip-principal.js";

/** Internal storage identity only. Never serialized as an API/Agent response. */
export interface TripParticipant extends TripParticipantView { principalSubject: string; ownerSubject: string; grantId: string }
export interface ShareGrant extends ShareGrantView { ownerSubject: string; secretHash: string }
export interface TripMutationGuard { participant: TripParticipant; grant: ShareGrant }
export interface TripAccess { owner: TripPrincipal; role: TripRole; guard?: TripMutationGuard }
export interface TripAuthorizer {
  authorize(principal: TripPrincipal, tripId: string, required: "read" | "write" | "owner"): Promise<TripAccess>;
}
export interface TripSharingRepository {
  participant(principal: TripPrincipal, tripId: string): Promise<TripParticipant | undefined>;
  grant(id: string): Promise<ShareGrant | undefined>;
  createGrant(grant: ShareGrant, trip: Trip): Promise<void>;
  replaceGrant(old: ShareGrant, next: ShareGrant): Promise<void>;
  putParticipant(next: TripParticipant, old: TripParticipant | undefined, grant: ShareGrant, trip: Trip): Promise<void>;
  replaceParticipant(old: TripParticipant, next: TripParticipant): Promise<void>;
  memberships(principal: TripPrincipal, after?: string): Promise<{ members: TripParticipant[]; after?: string }>;
  management(owner: TripPrincipal, tripId: string, after?: string): Promise<{ members: TripParticipant[]; grants: ShareGrant[]; after?: string }>;
  /** Owner target lookup by opaque participant id; base-verified, not a client subject. */
  managedParticipant(owner: TripPrincipal, tripId: string, id: string): Promise<TripParticipant | undefined>;
}
export interface ShareSecret { issue(): { secret: string; hash: string }; verify(secret: string, hash: string): boolean; id(): string }
export interface ShareAbuseGuard { consume(principal: TripPrincipal): Promise<void> }
