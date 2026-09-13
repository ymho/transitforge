import { exactKeys, validInstant } from "./snapshot-validation";
import { validateZonedInstant, type ZonedInstant } from "./itinerary-schedule";
import type { TripUpdateProposal } from "./trip";

export const reservationStatuses = ["not-booked", "booked", "cancelled", "not-required", "unknown"] as const;
export const reservationKinds = ["transport", "accommodation", "activity", "restaurant", "other"] as const;
/** Independent booking record. Selection, availability and the Trip revision are NOT booking facts. */
export interface Reservation {
  readonly id: string;
  readonly tripId: string;
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly itineraryItemId?: string;
  readonly kind: typeof reservationKinds[number];
  readonly status: typeof reservationStatuses[number];
  readonly provider?: string;
  readonly providerItemId?: string;
  readonly bookedAt?: string;
  readonly startsAt?: ZonedInstant;
  readonly endsAt?: ZonedInstant;
  /** Private: never project this into ordinary cards, Agent Context, errors or logs. */
  readonly bookingReference?: string;
}
export function reservationText(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid reservation field");
}
export function reservationId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) throw new Error("Invalid reservation identity");
}
export function validateReservation(r: Reservation): void {
  exactKeys(r, ["id", "tripId", "schemaVersion", "revision", "itineraryItemId", "kind", "status", "provider", "providerItemId", "bookedAt", "startsAt", "endsAt", "bookingReference"]);
  reservationId(r.id); reservationId(r.tripId);
  if (r.schemaVersion !== 1 || !Number.isSafeInteger(r.revision) || r.revision < 0 ||
    !reservationKinds.includes(r.kind) || !reservationStatuses.includes(r.status)) throw new Error("Invalid reservation");
  if (r.itineraryItemId !== undefined) reservationText(r.itineraryItemId, 200);
  if (r.provider !== undefined) reservationText(r.provider, 100);
  if (r.providerItemId !== undefined) { reservationText(r.providerItemId, 200); if (!r.provider) throw new Error("Reservation provider required"); }
  if (r.bookingReference !== undefined) reservationText(r.bookingReference, 200);
  if (r.bookedAt !== undefined && (r.bookedAt.length > 64 || !validInstant(r.bookedAt))) throw new Error("Invalid booking instant");
  for (const at of [r.startsAt, r.endsAt]) if (at !== undefined) {
    reservationText(at.at, 64); reservationText(at.timeZone, 100); validateZonedInstant(at);
  }
  if (r.startsAt && r.endsAt && Date.parse(r.endsAt.at) < Date.parse(r.startsAt.at)) throw new Error("Reservation ends before start");
}

/** Public read projection shared by Workspace, Agent and the future feasibility evaluator. */
export interface ReservationFact {
  readonly reservationId: string;
  readonly revision: number;
  readonly itineraryItemId?: string;
  readonly kind: Reservation["kind"];
  readonly status: Reservation["status"];
  readonly startsAt?: ZonedInstant;
  readonly endsAt?: ZonedInstant;
}
export function reservationFact(r: Reservation): ReservationFact {
  validateReservation(r);
  return { reservationId: r.id, revision: r.revision, kind: r.kind, status: r.status,
    ...(r.itineraryItemId === undefined ? {} : { itineraryItemId: r.itineraryItemId }),
    ...(r.startsAt ? { startsAt: { at: r.startsAt.at, timeZone: r.startsAt.timeZone } } : {}),
    ...(r.endsAt ? { endsAt: { at: r.endsAt.at, timeZone: r.endsAt.timeZone } } : {}) };
}
/** Re-allowlist projections at model/UI boundaries too; do not spread supplied objects. */
export function validateReservationFact(r: ReservationFact): void {
  exactKeys(r, ["reservationId", "revision", "itineraryItemId", "kind", "status", "startsAt", "endsAt"]);
  validateReservation({ id: r.reservationId, tripId: r.reservationId, schemaVersion: 1, revision: r.revision,
    kind: r.kind, status: r.status, itineraryItemId: r.itineraryItemId, startsAt: r.startsAt, endsAt: r.endsAt });
}
export function bookedReservationChanges(proposal: TripUpdateProposal, facts: readonly ReservationFact[]): ReservationFact[] {
  const changed = new Set(proposal.patches.flatMap((p) => p.type === "remove" || p.type === "replace" ? [p.itemId] : []));
  return facts.filter((r) => { validateReservationFact(r); return r.status === "booked" && r.itineraryItemId !== undefined && changed.has(r.itineraryItemId); });
}
/** Confirmation is bound to the exact proposal and the observed reservation revisions, not a boolean. */
export function reservationChangeKey(proposal: TripUpdateProposal, facts: readonly ReservationFact[]): string {
  return JSON.stringify([proposal, bookedReservationChanges(proposal, facts).map((r) => [r.reservationId, r.revision]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}
