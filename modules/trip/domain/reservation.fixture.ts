import type { Reservation } from "./reservation";
export const reservationTripId = "11111111-1111-4111-8111-111111111111";
export const reservationFixture = (changes: Partial<Reservation> = {}): Reservation => ({
  id: "22222222-2222-4222-8222-222222222222", tripId: reservationTripId,
  schemaVersion: 1, revision: 0, kind: "activity", status: "booked", itineraryItemId: "activity",
  bookingReference: "PRIVATE-TEST-REFERENCE", ...changes,
});
