import { validateTrip, type Trip } from "./trip";
import { validateReservationFact, type ReservationFact } from "./reservation";
import { validateChecklistItems, checklistCategories, type TripChecklistItem } from "./trip-checklist";
import type { TripFeasibilityEvaluation, TripFeasibilityIssue } from "./trip-feasibility";
import { blocksReady, hasReadyBlockers } from "./trip-ready";
import { validInstant } from "./snapshot-validation";

export interface ChecklistRelationWarning {
  checklistItemId: string;
  code: "itinerary_link_missing" | "reservation_link_missing" | "reservation_link_unchecked";
}
export interface TripReadiness {
  tripId: string;
  tripRevision: number;
  evaluatedAt: string;
  planning: TripFeasibilityIssue[];
  booking: TripFeasibilityIssue[];
  /** Full Feasibility policy, never derived from preparation counts or truncated issues. */
  blocksReady: boolean;
  planningBlocksReady: boolean;
  bookingBlocksReady: boolean;
  feasibilityStatus: TripFeasibilityEvaluation["status"];
  reservations: { readState: "available" | "unavailable"; records: ReservationFact[]; unrecordedItemIds: string[] };
  preparation: {
    readState: "available" | "unavailable";
    categories: { category: TripChecklistItem["category"]; open: number; done: number; notNeeded: number }[];
    archived: number;
    warnings: ChecklistRelationWarning[];
  };
}
/** Application supplies a freshly evaluated matching Trip. This view is not a ready certificate. */
export function projectTripReadiness(trip: Trip, evaluation: TripFeasibilityEvaluation,
  reservations: readonly ReservationFact[] | undefined, checklist: readonly TripChecklistItem[] | undefined): TripReadiness {
  validateTrip(trip);
  if (evaluation.tripId !== trip.id || evaluation.tripRevision !== trip.revision || !validInstant(evaluation.evaluatedAt)) throw new Error("Stale feasibility projection");
  reservations?.forEach(validateReservationFact);
  if (reservations && new Set(reservations.map((r) => r.reservationId)).size !== reservations.length) throw new Error("Duplicate reservation fact");
  if (checklist) validateChecklistItems(trip.id, checklist);
  const isBooking = (i: TripFeasibilityIssue) => i.code.startsWith("reservation") || i.code === "stay_reservation_time_precision";
  const planning = evaluation.issues.filter((i) => !isBooking(i)), booking = evaluation.issues.filter(isBooking);
  const warnings: ChecklistRelationWarning[] = [];
  for (const item of checklist ?? []) {
    if (item.relatedItineraryItemId && !trip.items.some((i) => i.id === item.relatedItineraryItemId)) warnings.push({ checklistItemId: item.id, code: "itinerary_link_missing" });
    if (item.relatedReservationId && !reservations?.some((r) => r.reservationId === item.relatedReservationId)) warnings.push({ checklistItemId: item.id,
      code: reservations ? "reservation_link_missing" : "reservation_link_unchecked" });
  }
  return structuredClone({ tripId: trip.id, tripRevision: trip.revision, evaluatedAt: evaluation.evaluatedAt,
    planning, booking, blocksReady: hasReadyBlockers(evaluation), planningBlocksReady: planning.some(blocksReady), bookingBlocksReady: booking.some(blocksReady),
    feasibilityStatus: evaluation.status,
    reservations: { readState: reservations ? "available" : "unavailable", records: [...(reservations ?? [])],
      // No record means unconfirmed coverage, never "not-booked" (even for a selected hotel).
      unrecordedItemIds: reservations ? trip.items.filter((i) => !reservations.some((r) => r.itineraryItemId === i.id)).map((i) => i.id) : [] },
    preparation: { readState: checklist ? "available" : "unavailable", archived: checklist?.filter((i) => i.archived).length ?? 0, warnings,
      categories: checklistCategories.map((category) => { const items = checklist?.filter((i) => !i.archived && i.category === category) ?? [];
        return { category, open: items.filter((i) => i.status === "open").length, done: items.filter((i) => i.status === "done").length,
          notNeeded: items.filter((i) => i.status === "not-needed").length }; }) } });
}
