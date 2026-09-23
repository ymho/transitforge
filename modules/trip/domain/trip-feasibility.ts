import { validateTrip, type Trip, type ItineraryItem } from "./trip";
import { samePlaceIdentity, type PlaceSnapshot } from "./place-snapshot";
import { evaluateTripHardConstraints } from "./trip-constraint-evaluation";
import { readFeasibilityFacts } from "./trip-feasibility-facts";
import { orderedScheduleRelation } from "./trip-feasibility-schedule";
import { isSelectedStay, stayDateRelation, stayReservationDateConflict } from "./trip-feasibility-stay";
import type { TripFeasibilityFacts, TripFeasibilityEvaluation, TripFeasibilityIssue, TripFeasibilityCode } from "./trip-feasibility-contract";
import { buildTemporalConstraintNetwork, checkTemporalConsistency, type TemporalBuildFact } from "./temporal-constraint-network";
export type { TripFeasibilityFacts, TripFeasibilityEvaluation, TripFeasibilityIssue } from "./trip-feasibility-contract";

/** Pure planned feasibility. Does not fetch, optimize, mutate Trip, or use realtime observations.
 * Trip validation already validates SelectedRailJourney's scheduled legs and transfers; do not
 * reimplement that invariant or apply live delays here. evaluatedAt is supplied by Application.
 */
export function evaluateTripFeasibility(trip: Trip, input: TripFeasibilityFacts | undefined, evaluatedAt: string): TripFeasibilityEvaluation {
  validateTrip(trip);
  const { facts, reservations, invalid, visitObservationItemIds } = readFeasibilityFacts(trip, input, evaluatedAt);
  const issues: TripFeasibilityIssue[] = [];
  const issue = (code: TripFeasibilityCode, itemIds: readonly string[], status: "violated" | "unknown" = "unknown",
    extra: Partial<Pick<TripFeasibilityIssue, "reservationIds" | "constraintIds" | "evidenceIds" | "details">> = {}) => {
    issues.push({ code, severity: status === "violated" ? "error" : "warning", status, itemIds: [...itemIds], ...extra });
  };
  if (!trip.items.length) issue("empty_trip", []);
  if (invalid) issue("external_facts_invalid", []);
  if (reservations === undefined) issue("reservations_unknown", []);
  for (const item of trip.items) {
    if (item.schedule.type !== "fixed" || !item.schedule.endAt) {
      const code = isSelectedStay(item) ? "stay_time_precision" :
        item.schedule.type === "window" && item.schedule.durationMinutes !== undefined ? "window_time_precision" : "schedule_unknown";
      issue(code, [item.id], "unknown", { details: { precision: item.schedule.type } });
    }
    if (item.type === "transport") {
      if (item.detail.status === "unresolved") issue("transport_unresolved", [item.id]);
      else if (item.detail.mode !== "rail") {
        const durationFacts = facts.filter((f) => f.data.type === "transport" && f.data.item.id === item.id);
        if (!durationFacts.length) issue("transport_unverified", [item.id]);
        for (const f of durationFacts) {
          if (f.data.type !== "transport") continue;
          const s = item.schedule;
          const plannedMinutes = s.type === "fixed" && s.endAt ? (Date.parse(s.endAt.at) - Date.parse(s.startAt.at)) / 60_000 :
            s.type === "window" ? s.durationMinutes : undefined;
          if (plannedMinutes !== undefined && plannedMinutes < f.data.minimumMinutes) {
            issue("movement_insufficient", [item.id], "violated", { evidenceIds: f.evidenceIds, details: { minimumMinutes: f.data.minimumMinutes } });
          }
        }
      }
    } else {
      if (item.type === "stay" && item.selection.status === "unselected") issue("stay_unselected", [item.id]);
      // Unplaced free time is not a claim about a facility's opening hours or admission.
      if (item.type === "stay" || item.category !== "free-time") {
        const visits = facts.filter((f) => f.data.type === "visit" && f.data.item.id === item.id);
        if (!visits.length) issue(isSelectedStay(item) && !visitObservationItemIds.has(item.id) ? "stay_visit_unchecked" : "visit_unknown", [item.id]);
        for (const f of visits) {
          if (f.data.type !== "visit") continue;
          if (!f.data.available) issue("visit_unavailable", [item.id], "violated", { evidenceIds: f.evidenceIds });
          if (f.data.reservationRequired && !reservations?.some((r) => r.itineraryItemId === item.id && r.status === "booked")) {
            // Missing/unknown/cancelled records do not prove no other real-world booking exists.
            const linked = reservations?.filter((r) => r.itineraryItemId === item.id) ?? [];
            const explicitlyUnbooked = linked.length > 0 && linked.every((r) => r.status === "not-booked");
            issue("reservation_required", [item.id], explicitlyUnbooked ? "violated" : "unknown", { evidenceIds: f.evidenceIds,
              ...(linked.length ? { reservationIds: linked.map((r) => r.reservationId) } : {}) });
          }
        }
      }
    }
  }
  // Non-adjacent fixed items can overlap across an unknown/day item. Never sort adopted order.
  for (let i = 0; i < trip.items.length; i++) for (let j = i + 1; j < trip.items.length; j++) {
    const a = trip.items[i]!, b = trip.items[j]!;
    const relation = orderedScheduleRelation(a.schedule, b.schedule);
    if (relation === "violated" || stayDateRelation(a, b) === "violated") issue("schedule_overlap", [a.id, b.id], "violated");
    else if (relation === "possible") issue("schedule_window_possible", [a.id, b.id]);
  }
  for (let i = 1; i < trip.items.length; i++) {
    const a = trip.items[i - 1]!, b = trip.items[i]!;
    const origin = endpoint(a, "end"), destination = endpoint(b, "start");
    if (samePlaceIdentity(origin?.ref, destination?.ref)) continue;
    const routes = facts.filter((f) => f.data.type === "movement" && f.data.beforeItem.id === a.id && f.data.afterItem.id === b.id);
    if (!routes.length) { issue("movement_unknown", [a.id, b.id]); continue; }
    for (const route of routes) {
      if (route.data.type !== "movement") continue;
      const relation = orderedScheduleRelation(a.schedule, b.schedule, route.data.minimumMinutes);
      const stayRelation = stayDateRelation(a, b, route.data.minimumMinutes);
      const violated = relation === "violated" || stayRelation === "violated";
      if (relation !== "satisfied") issue(violated ? "movement_insufficient" : stayRelation === "precision" ? "stay_movement_time_precision" : "movement_unknown", [a.id, b.id],
        violated ? "violated" : "unknown", { evidenceIds: route.evidenceIds, details: { minimumMinutes: route.data.minimumMinutes } });
    }
  }
  const temporalFacts: TemporalBuildFact[] = facts.flatMap((fact) => fact.data.type === "movement" ? [{ type: "travel-lower-bound" as const,
    constraintId: `movement:${fact.data.beforeItem.id}:${fact.data.afterItem.id}`, beforeItemId: fact.data.beforeItem.id,
    afterItemId: fact.data.afterItem.id, minutes: fact.data.minimumMinutes, evidenceRefs: fact.evidenceIds }] : []);
  temporalFacts.push(...(trip.structureIntent?.relations.map((relation) => ({ type: "explicit-order" as const, constraintId: relation.relationId,
    beforeItemId: relation.beforeItemRef, afterItemId: relation.afterItemRef, evidenceRefs: relation.evidenceRefs ?? [] })) ?? []));
  temporalFacts.push(...(reservations ?? []).flatMap((reservation) => reservation.status === "booked" && reservation.itineraryItemId && (reservation.startsAt || reservation.endsAt)
    ? [{ type: "reservation-anchor" as const, constraintId: `reservation:${reservation.reservationId}`, itemId: reservation.itineraryItemId,
      ...(reservation.startsAt ? { startsAt: reservation.startsAt.at } : {}), ...(reservation.endsAt ? { endsAt: reservation.endsAt.at } : {}), evidenceRefs: [] }] : []));
  const temporal = checkTemporalConsistency(buildTemporalConstraintNetwork(trip, temporalFacts));
  if (temporal.status === "infeasible") issue("temporal_network_conflict", [...new Set(temporal.conflictEdges.flatMap((edge) => edge.itemIds))], "violated", {
    evidenceIds: [...new Set(temporal.conflictEdges.flatMap((edge) => edge.evidenceRefs))],
    details: { constraintRefs: temporal.conflictEdges.map(({ constraintId }) => constraintId).join(",") },
  });
  if (temporal.exhaustedBudget) issue("temporal_network_budget", temporal.evaluatedScope);
  for (const r of reservations ?? []) {
    if (!r.itineraryItemId) {
      if (r.status === "booked" || r.status === "unknown") issue("reservation_unknown", [], "unknown", { reservationIds: [r.reservationId] });
      continue; // An unlinked record cannot be silently assigned by name.
    }
    const item = trip.items.find((i) => i.id === r.itineraryItemId);
    const extra = { reservationIds: [r.reservationId] };
    if (!item) { issue("reservation_dangling", [r.itineraryItemId], "unknown", extra); continue; }
    if (r.status === "unknown") { issue("reservation_unknown", [item.id], "unknown", extra); continue; }
    if (r.status !== "booked") continue;
    const s = item.schedule;
    if (isSelectedStay(item) && s.type === "day" && s.timeZone) {
      const conflict = stayReservationDateConflict(item, r.startsAt, r.endsAt);
      issue(conflict ? "reservation_conflict" : "stay_reservation_time_precision", [item.id], conflict ? "violated" : "unknown", extra);
      continue;
    }
    if (s.type !== "fixed" || !s.endAt || !r.startsAt && !r.endsAt) {
      issue("reservation_time_unknown", [item.id], "unknown", extra); continue;
    }
    // A booked fixed occurrence is not a flexible visit interval: preserve both confirmed endpoints.
    if (r.startsAt && Date.parse(r.startsAt.at) !== Date.parse(s.startAt.at) ||
        r.endsAt && Date.parse(r.endsAt.at) !== Date.parse(s.endAt.at)) issue("reservation_conflict", [item.id], "violated", extra);
  }
  const costs = facts.flatMap((f) => f.data.type === "cost" ? [{ itemId: f.data.item.id, total: f.data.total, evidenceIds: f.evidenceIds }] : []);
  for (const evaluation of evaluateTripHardConstraints(trip, { costs })) {
    if (evaluation.status === "satisfied") continue;
    const condition = trip.request.constraints.find((c) => c.id === evaluation.constraintId)!;
    const itemIds = condition.scope.type === "item" ? [condition.scope.itemId] : trip.items.map((i) => i.id);
    issue(evaluation.status === "violated" ? "hard_constraint_violated" : "hard_constraint_unknown", itemIds, evaluation.status,
      { constraintIds: [evaluation.constraintId], details: { reason: evaluation.reasonCode },
        ...(condition.requirement.type === "budget" ? { evidenceIds: costs.flatMap((c) => c.evidenceIds) } : {}) });
  }
  for (const assumption of trip.request.assumptions) if (assumption.status === "unconfirmed") {
    issue("assumption_unconfirmed", assumption.affects.flatMap((a) => a.type === "item" ? [a.itemId] : []));
  }
  return { tripId: trip.id, tripRevision: trip.revision,
    status: issues.some((i) => i.status === "violated") ? "infeasible" : issues.length ? "unknown" : "feasible", issues, evaluatedAt };
}

function endpoint(item: ItineraryItem, side: "start" | "end"): PlaceSnapshot | undefined {
  if (item.type === "activity") return item.place;
  if (item.type === "stay") return item.selection.status === "selected" ? item.selection.accommodation.place : item.selection.place;
  if (item.detail.status === "unresolved") return undefined;
  if (item.detail.mode !== "rail") return side === "start" ? item.detail.origin : item.detail.destination;
  return side === "start" ? item.detail.journey.legs[0]!.origin : item.detail.journey.legs.at(-1)!.destination;
}
