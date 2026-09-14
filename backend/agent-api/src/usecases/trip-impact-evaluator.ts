import { evaluateRailTripImpact } from "@raiquora/trip/rail-trip-impact";
import { evaluateAreaTripImpact } from "@raiquora/trip/area-trip-impact";
import type { TripImpactEvaluator } from "../ports/trip-impact-evaluator.js";

/** Dispatches external fact kinds, not user utterances or Agent tools. */
export class DeterministicTripImpactEvaluator implements TripImpactEvaluator {
  async evaluate(input: Parameters<TripImpactEvaluator["evaluate"]>[0]) {
    return input.event.kind === "rail-operation" ? evaluateRailTripImpact(input) : evaluateAreaTripImpact(input);
  }
}
