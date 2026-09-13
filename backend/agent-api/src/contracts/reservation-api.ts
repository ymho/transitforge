import { validateReservation, reservationId, reservationText, type Reservation } from "@raiquora/trip/reservation";
import { TripResourceError } from "./trip-api.js";

export const reservationApiVersion = "reservation-api-v1";
export const reservationDetailFields = ["kind", "status", "provider", "providerItemId", "bookedAt", "startsAt", "endsAt", "bookingReference"] as const;
export type ReservationDetails = Pick<Reservation, typeof reservationDetailFields[number]>;
export type ReservationCommand =
  | { operation: "create"; reservation: Reservation }
  | { operation: "get"; tripId: string; reservationId: string }
  | { operation: "list"; tripId: string }
  | { operation: "update"; tripId: string; reservationId: string; baseRevision: number; details: ReservationDetails }
  | { operation: "cancel" | "unlink"; tripId: string; reservationId: string; baseRevision: number }
  | { operation: "link"; tripId: string; reservationId: string; baseRevision: number; itineraryItemId: string };
export function boundedReservation(value: unknown): Reservation {
  try { validateReservation(value as Reservation); return structuredClone(value as Reservation); }
  catch { throw new TripResourceError("invalid-input"); }
}
export function parseReservationCommand(value: unknown): ReservationCommand {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const c = value as ReservationCommand;
    const fields: string[] = ["operation"];
    if (c.operation === "create") { fields.push("reservation"); const r = boundedReservation(c.reservation); if (r.revision !== 0) throw new Error(); }
    else {
      fields.push("tripId"); reservationId(c.tripId);
      if (c.operation !== "list") { fields.push("reservationId"); reservationId(c.reservationId); }
      if (["update", "cancel", "link", "unlink"].includes(c.operation)) {
        fields.push("baseRevision"); const n = (c as { baseRevision: number }).baseRevision;
        if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER) throw new Error();
      } else if (c.operation !== "get" && c.operation !== "list") throw new Error();
      if (c.operation === "link") { fields.push("itineraryItemId"); reservationText(c.itineraryItemId, 200); }
      if (c.operation === "update") {
        fields.push("details");
        if (!c.details || Object.keys(c.details).some((key) => !(reservationDetailFields as readonly string[]).includes(key))) throw new Error();
        boundedReservation({ ...c.details, id: c.reservationId, tripId: c.tripId, schemaVersion: 1, revision: c.baseRevision });
      }
    }
    if (Object.keys(c).some((key) => !fields.includes(key))) throw new Error();
    return structuredClone(c);
  } catch { throw new TripResourceError("invalid-input"); }
}
