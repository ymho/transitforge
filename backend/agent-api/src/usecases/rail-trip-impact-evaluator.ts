import { evaluateRailTripImpact } from "@raiquora/trip/rail-trip-impact";
import type { TripImpactEvaluator } from "../ports/trip-impact-evaluator.js";

export class RailTripImpactEvaluator implements TripImpactEvaluator {
  async evaluate(input: Parameters<TripImpactEvaluator["evaluate"]>[0]) { return evaluateRailTripImpact(input); }
}
