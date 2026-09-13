import type { Trip, ItineraryItem } from "./trip";
import type { ReservationFact } from "./reservation";
import type { ExternalTravelInformation } from "./external-travel-information";
import type { Money } from "./money";

export type TripFeasibilityStatus = "feasible" | "infeasible" | "unknown";
export type TripFeasibilityCode =
  | "empty_trip" | "schedule_unknown" | "schedule_overlap" | "schedule_window_possible"
  | "movement_unknown" | "movement_insufficient" | "transport_unresolved" | "transport_unverified"
  | "stay_unselected" | "visit_unknown" | "visit_unavailable" | "external_facts_invalid"
  | "hard_constraint_violated" | "hard_constraint_unknown" | "assumption_unconfirmed"
  | "reservations_unknown" | "reservation_unknown" | "reservation_time_unknown"
  | "reservation_conflict" | "reservation_dangling" | "reservation_required";
export interface TripFeasibilityIssue {
  code: TripFeasibilityCode;
  severity: "info" | "warning" | "error";
  status: "violated" | "unknown";
  itemIds: string[];
  reservationIds?: string[];
  constraintIds?: string[];
  evidenceIds?: string[];
  details?: Record<string, string | number | boolean>;
}
export interface TripFeasibilityEvaluation {
  tripId: string;
  tripRevision: number;
  status: TripFeasibilityStatus;
  issues: TripFeasibilityIssue[];
  evaluatedAt: string;
}

/** Acquired facts bound to the exact adopted item, NOT candidate facts. Reuse ItineraryItem
 * as a read-only subject: changing its selection/schedule invalidates the observation.
 * These inputs are short-lived and never persisted in Trip or projected into Agent context.
 * A reviewed adapter establishes completeness/availability; a model cannot issue this input.
 */
export type TripFeasibilityFact =
  | { type: "movement"; beforeItem: ItineraryItem; afterItem: ItineraryItem; minimumMinutes: number }
  | { type: "transport"; item: ItineraryItem; minimumMinutes: number }
  | { type: "visit"; item: ItineraryItem; available: boolean; reservationRequired: boolean }
  | { type: "cost"; item: ItineraryItem; total: Money; coverage: "complete-item"; party: Trip["request"]["party"] };
export interface TripFeasibilityFacts {
  tripId: string;
  tripRevision: number;
  /** undefined is unavailable; [] is a complete read with no registered reservations. */
  reservations?: readonly ReservationFact[];
  external?: readonly ExternalTravelInformation<TripFeasibilityFact>[];
}
