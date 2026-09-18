import { validateReservationFact, type ReservationFact } from "@raiquora/trip/reservation";

export interface AgentReservationContext {
  status: "available" | "unknown";
  facts: ReservationFact[];
  truncated: boolean;
}
/** No Reservation entity is accepted here. Explicitly selected fields survive all model budgets. */
export function reservationContext(facts?: readonly ReservationFact[], focusedItemId?: string): AgentReservationContext {
  if (facts === undefined) return { status: "unknown", facts: [], truncated: false };
  facts.forEach(validateReservationFact);
  const ordered = [...facts].sort((a, b) => Number(b.itineraryItemId === focusedItemId) - Number(a.itineraryItemId === focusedItemId) || Number(b.status === "booked") - Number(a.status === "booked"));
  return { status: "available", truncated: facts.length > 24, facts: ordered.slice(0, 24).map((r) => ({
    reservationId: r.reservationId, revision: r.revision, kind: r.kind, status: r.status,
    ...(r.itineraryItemId === undefined ? {} : { itineraryItemId: r.itineraryItemId }),
    ...(r.startsAt ? { startsAt: { at: r.startsAt.at, timeZone: r.startsAt.timeZone } } : {}),
    ...(r.endsAt ? { endsAt: { at: r.endsAt.at, timeZone: r.endsAt.timeZone } } : {}),
  })) };
}
