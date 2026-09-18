import type { Trip } from "@raiquora/trip/trip";
import type { TripRole, SharedTripRole, ShareGrantView, TripParticipantView } from "@raiquora/trip/trip-sharing";
/** UI/transport port. No subject, hash, private resource or authentication assertion. */
export interface TripSharingClient {
  create(tripId: string, role: SharedTripRole, expiresAt?: string): Promise<{ grant: ShareGrantView; secret: string }>;
  redeem(link: TripShareLink): Promise<{ tripId: string; role: TripRole }>;
  revoke(tripId: string, grant: ShareGrantView): Promise<void>;
  manage(tripId: string, after?: string): Promise<{ participants: TripParticipantView[]; grants: ShareGrantView[]; after?: string }>;
  participant(tripId: string, participant: TripParticipantView, role: SharedTripRole, active: boolean): Promise<void>;
  accessible(afterTripId?: string): Promise<{ trips: { trip: Trip; role: TripRole }[]; afterTripId?: string }>;
}
/** Ephemeral redeem input only. Never put this in a Conversation, Trip or Agent context. */
export interface TripShareLink { tripId: string; grantId: string; secret: string; }
