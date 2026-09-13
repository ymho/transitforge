import type { Reservation, ReservationFact } from "@raiquora/trip/reservation";
import type { TripPrincipal } from "./trip-repository.js";

/** Owner-scoped independent records; intentionally no delete/cascade operation. */
export interface ReservationRepository {
  create(principal: TripPrincipal, reservation: Reservation): Promise<Reservation>;
  get(principal: TripPrincipal, tripId: string, reservationId: string): Promise<Reservation | undefined>;
  list(principal: TripPrincipal, tripId: string): Promise<Reservation[]>;
  replace(principal: TripPrincipal, reservation: Reservation, baseRevision: number): Promise<Reservation>;
}
/** Complete, consistent read or an error: never silently truncate protected reservations. */
export interface ReservationReader {
  facts(principal: TripPrincipal, tripId: string): Promise<ReservationFact[]>;
}
