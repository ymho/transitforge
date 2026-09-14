import { exactKeys, validInstant } from "./snapshot-validation";
import { monitoringKey, monitoringRevision, monitoringText } from "./trip-watch";
import { validateTrip, type Trip } from "./trip";
import { validateTravelEvent, type TravelEvent } from "./travel-event";
import { validateTripImpactFact, type TripImpactFact } from "./trip-impact-fact";
export type { TripImpactFact } from "./trip-impact-fact";

export const tripImpactReasons = ["external_data_unknown", "rail_delay", "rail_cancelled", "destination_changed", "destination_unverified", "long_stop",
  "connection_risk", "appointment_risk", "hazard_exposure", "weather_exposure", "no_material_change"] as const;
export type TripImpactReason = typeof tripImpactReasons[number];
/** Derived result, not a Trip child, notification, public hazard severity or planned feasibility. */
export interface TripImpact {
  readonly id: string;
  readonly tripId: string;
  readonly tripRevision: number;
  readonly eventId: string;
  readonly policyVersion: string;
  readonly facts: readonly TripImpactFact[];
  readonly status: "unknown" | "no-impact" | "impact";
  readonly severity: "informational" | "attention" | "action-required" | "critical";
  readonly affectedItemIds: readonly string[];
  readonly reasonCodes: readonly TripImpactReason[];
  readonly evaluatedAt: string;
}
export function tripImpactId(impact: Omit<TripImpact, "id">): string {
  return monitoringKey(["impact-v2", impact.tripId, impact.tripRevision, impact.eventId, impact.policyVersion, impact.status, impact.severity,
    [...impact.affectedItemIds].sort(), [...impact.reasonCodes].sort(), impact.facts]);
}
export function validateTripImpact(impact: TripImpact): void {
  exactKeys(impact, ["id", "tripId", "tripRevision", "eventId", "policyVersion", "facts", "status", "severity", "affectedItemIds", "reasonCodes", "evaluatedAt"]);
  monitoringText(impact.policyVersion, 100);
  if (!Array.isArray(impact.facts) || impact.facts.length > 2000) throw new Error("Invalid impact facts");
  impact.facts.forEach((fact) => {
    validateTripImpactFact(fact);
    const ids = fact.type === "schedule-risk" ? [fact.fromItemId, fact.toItemId] : [fact.itemId];
    if (ids.some((id) => !impact.affectedItemIds.includes(id))) throw new Error("Impact fact outside affected items");
  });
  monitoringText(impact.tripId); monitoringText(impact.eventId, 24000); monitoringRevision(impact.tripRevision);
  if (!validInstant(impact.evaluatedAt) || !["unknown", "no-impact", "impact"].includes(impact.status) ||
      !["informational", "attention", "action-required", "critical"].includes(impact.severity) ||
      impact.status !== "impact" && impact.severity !== "informational" ||
      !Array.isArray(impact.affectedItemIds) || !impact.affectedItemIds.length || impact.affectedItemIds.length > 200 ||
      new Set(impact.affectedItemIds).size !== impact.affectedItemIds.length || !Array.isArray(impact.reasonCodes) ||
      !impact.reasonCodes.length || new Set(impact.reasonCodes).size !== impact.reasonCodes.length ||
      !impact.reasonCodes.every((code) => tripImpactReasons.includes(code))) throw new Error("Invalid Trip impact");
  impact.affectedItemIds.forEach((id) => monitoringText(id));
  if (impact.id !== tripImpactId(impact)) throw new Error("Invalid impact identity");
}
/** Old results remain historical; never silently rebase to a newer plan. */
export function isCurrentTripImpact(impact: TripImpact, trip: Trip, event: TravelEvent): boolean {
  validateTripImpact(impact); validateTrip(trip); validateTravelEvent(event);
  return impact.tripId === trip.id && impact.tripRevision === trip.revision && impact.eventId === event.id &&
    impact.affectedItemIds.every((id) => trip.items.some((item) => item.id === id));
}
