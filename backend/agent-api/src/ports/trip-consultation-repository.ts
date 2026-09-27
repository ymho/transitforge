import type { Trip } from "@raiquora/trip/trip";
import type { TripPrincipal } from "../contracts/trip-principal.js";
export interface TripConsultationRepository {
  /** One durable idempotent transaction for Trip, its history header and start receipt. */
  start(principal: TripPrincipal, input: { tripId: string; title: string }): Promise<{ trip: Trip; conversationId: string }>;
}
