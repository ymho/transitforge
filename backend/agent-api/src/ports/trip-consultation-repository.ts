import type { Trip } from "@raiquora/trip/trip";
import type { TripPrincipal } from "../contracts/trip-principal.js";
export interface TripConsultationRepository {
  /** One durable idempotent transaction for Trip, its history header and start receipt. */
  start(principal: TripPrincipal, input: { tripId: string; title: string }): Promise<{ trip: Trip; conversationId: string }>;
  /** Snapshot one Trip and its public history. Runtime turns and actionable proposals are never replayed. */
  branch(principal: TripPrincipal, input: { sourceTripId: string; sourceRevision: number; tripId: string; title: string }): Promise<{ trip: Trip; conversationId: string; sourceTripId: string }>;
}
