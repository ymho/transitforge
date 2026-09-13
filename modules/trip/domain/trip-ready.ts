import type { Trip, TripUpdateProposal } from "./trip";
import type { TripFeasibilityEvaluation, TripFeasibilityFacts } from "./trip-feasibility";
import { evaluateTripFeasibility } from "./trip-feasibility";

export class TripNotFeasible extends Error {
  constructor(readonly evaluation: TripFeasibilityEvaluation) { super("Trip feasibility confirmation required"); }
}
export function requestsReady(proposal: TripUpdateProposal): boolean {
  return proposal.patches.filter((p) => p.type === "planning").at(-1)?.state === "ready";
}
/** Application supplies the actual post-proposal Trip, not a cached evaluation or a model's proof.
 * Revision-only matching is insufficient: facts are also bound to the exact adopted items.
 * Conservative first policy: every unknown blocks ready; drafts and repairs remain editable.
 */
export function requireFeasibleTrip(trip: Trip, facts: TripFeasibilityFacts | undefined, now: string): TripFeasibilityEvaluation {
  const evaluation = evaluateTripFeasibility(trip, facts, now);
  if (evaluation.status !== "feasible") throw new TripNotFeasible(evaluation);
  return evaluation;
}
