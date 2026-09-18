import type { TripFeasibilityEvaluation, TripFeasibilityIssue } from "@raiquora/trip/trip-feasibility";

export interface AgentTripFeasibilityContext extends Omit<TripFeasibilityEvaluation, "issues"> {
  issues: TripFeasibilityIssue[];
  totalIssueCount: number;
  truncated: boolean;
}
/** Only the deterministic projection reaches the model. No external payload/Reservation entity.
 * Overall status is never recomputed from the bounded subset (which could hide a violation).
 */
export function tripFeasibilityContext(evaluation: TripFeasibilityEvaluation, focusedItemId?: string): AgentTripFeasibilityContext {
  const ordered = [...evaluation.issues].sort((a, b) => Number(b.status === "violated") - Number(a.status === "violated") ||
    Number(b.itemIds.includes(focusedItemId ?? "")) - Number(a.itemIds.includes(focusedItemId ?? "")));
  return { tripId: evaluation.tripId, tripRevision: evaluation.tripRevision, status: evaluation.status, evaluatedAt: evaluation.evaluatedAt,
    totalIssueCount: evaluation.issues.length, truncated: ordered.length > 24, issues: ordered.slice(0, 24).map((issue) => ({
      code: issue.code, severity: issue.severity, status: issue.status, itemIds: [...issue.itemIds],
      ...(issue.reservationIds ? { reservationIds: [...issue.reservationIds] } : {}),
      ...(issue.constraintIds ? { constraintIds: [...issue.constraintIds] } : {}),
      ...(issue.evidenceIds ? { evidenceIds: [...issue.evidenceIds] } : {}),
      // Details are optional; codes/IDs suffice here and avoid accepting arbitrary narrative payloads.
    })) };
}
