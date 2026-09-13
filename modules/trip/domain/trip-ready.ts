import type { Trip, TripUpdateProposal } from "./trip";
import type { TripFeasibilityEvaluation, TripFeasibilityFacts, TripFeasibilityIssue } from "./trip-feasibility";
import { evaluateTripFeasibility } from "./trip-feasibility";

export class TripNotFeasible extends Error {
  constructor(readonly evaluation: TripFeasibilityEvaluation) { super("Trip feasibility confirmation required"); }
}
export function requestsReady(proposal: TripUpdateProposal): boolean {
  return proposal.patches.filter((p) => p.type === "planning").at(-1)?.state === "ready";
}
/** Readiness is not proof that all facts are known. Only explicitly informational
 * codes are exempt; missing routes, hard facts and reservation requirements remain blockers.
 * Applied to complete, freshly derived results, never the Agent's truncated projection.
 */
export function blocksReady(issue: TripFeasibilityIssue): boolean {
  if (issue.status === "violated") return true;
  switch (issue.code) {
    case "stay_visit_unchecked":
    case "stay_time_precision":
    case "stay_movement_time_precision":
    case "stay_reservation_time_precision":
    case "window_time_precision": return false;
    default: return true;
  }
}
export function hasReadyBlockers(evaluation: TripFeasibilityEvaluation): boolean {
  return evaluation.status === "infeasible" || evaluation.issues.some(blocksReady);
}
/** Application supplies the actual post-proposal Trip, not a cached evaluation or a model's proof.
 * Revision-only matching is insufficient: facts are also bound to the exact adopted items.
 * Unknown stays visible even when only non-blocking precision issues remain.
 */
export function requireFeasibleTrip(trip: Trip, facts: TripFeasibilityFacts | undefined, now: string): TripFeasibilityEvaluation {
  const evaluation = evaluateTripFeasibility(trip, facts, now);
  if (hasReadyBlockers(evaluation)) throw new TripNotFeasible(evaluation);
  return evaluation;
}
