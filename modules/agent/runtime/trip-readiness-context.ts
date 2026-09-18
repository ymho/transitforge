import type { TripReadiness } from "@raiquora/trip/trip-readiness";
import { validateChecklistItems, type TripChecklistItem } from "@raiquora/trip/trip-checklist";
import type { TripFeasibilityIssue } from "@raiquora/trip/trip-feasibility";

export interface AgentTripReadinessContext {
  tripId: string; tripRevision: number; evaluatedAt: string;
  blocksReady: boolean; feasibilityStatus: TripReadiness["feasibilityStatus"];
  planning: { code: TripFeasibilityIssue["code"]; status: TripFeasibilityIssue["status"]; itemIds: string[] }[];
  booking: { code: TripFeasibilityIssue["code"]; status: TripFeasibilityIssue["status"]; itemIds: string[] }[];
  reservationReadState: "available" | "unavailable";
  unrecordedItemIds: string[];
  preparationReadState: "available" | "unavailable";
  relationWarnings: TripReadiness["preparation"]["warnings"];
  preparation: { id: string; category: TripChecklistItem["category"]; title: string; status: TripChecklistItem["status"]; archived: boolean;
    relatedItineraryItemId?: string; relatedReservationId?: string }[];
  counts: { planning: number; booking: number; preparation: number };
  truncated: boolean;
}
/** Re-allowlist when compacting as well; arbitrary/private keys never survive projection. */
export function boundTripReadinessContext(c: AgentTripReadinessContext): AgentTripReadinessContext {
  const issues = (values: AgentTripReadinessContext["planning"]) => values.slice(0, 16).map((i) => ({ code: i.code, status: i.status, itemIds: i.itemIds.slice(0, 8).map((id) => id.slice(0, 200)) }));
  return { tripId: c.tripId, tripRevision: c.tripRevision, evaluatedAt: c.evaluatedAt, blocksReady: c.blocksReady, feasibilityStatus: c.feasibilityStatus,
    planning: issues(c.planning), booking: issues(c.booking), reservationReadState: c.reservationReadState,
    unrecordedItemIds: c.unrecordedItemIds.slice(0, 24), preparationReadState: c.preparationReadState,
    relationWarnings: c.relationWarnings.slice(0, 24).map((w) => ({ checklistItemId: w.checklistItemId, code: w.code })),
    preparation: c.preparation.slice(0, 24).map((i) => ({ id: i.id, category: i.category, title: i.title.slice(0, 200), status: i.status, archived: i.archived,
      ...(i.relatedItineraryItemId ? { relatedItineraryItemId: i.relatedItineraryItemId.slice(0, 200) } : {}),
      ...(i.relatedReservationId ? { relatedReservationId: i.relatedReservationId } : {}) })),
    counts: { planning: c.counts.planning, booking: c.counts.booking, preparation: c.counts.preparation },
    truncated: c.truncated || c.planning.length > 16 || c.booking.length > 16 || c.preparation.length > 24 || c.relationWarnings.length > 24 || c.unrecordedItemIds.length > 24 ||
      [...c.planning, ...c.booking].some((i) => i.itemIds.length > 8) };
}
export function tripReadinessContext(readiness: TripReadiness, items: readonly TripChecklistItem[] | undefined): AgentTripReadinessContext {
  if (items) validateChecklistItems(readiness.tripId, items);
  return boundTripReadinessContext({ tripId: readiness.tripId, tripRevision: readiness.tripRevision, evaluatedAt: readiness.evaluatedAt,
    blocksReady: readiness.blocksReady, feasibilityStatus: readiness.feasibilityStatus,
    planning: readiness.planning, booking: readiness.booking, reservationReadState: readiness.reservations.readState,
    unrecordedItemIds: readiness.reservations.unrecordedItemIds, preparationReadState: readiness.preparation.readState,
    relationWarnings: readiness.preparation.warnings,
    preparation: [...(items ?? [])], counts: { planning: readiness.planning.length, booking: readiness.booking.length, preparation: items?.length ?? 0 }, truncated: false });
}
