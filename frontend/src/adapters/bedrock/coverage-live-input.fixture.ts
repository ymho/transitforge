import { railSelectionFixture } from "../../../../modules/trip/domain/selected-rail-journey.fixture";
import { assessedInformation } from "../../../../modules/trip/domain/candidate-assessment.fixture";
import { requestConstraint } from "../../../../modules/trip/domain/trip-request.fixture";
import type { CandidateAssessmentFacts } from "@raiquora/trip/travel-candidate-assessment";

/** Synthetic trusted station resolution, not name-based production identity inference. */
export function coverageLiveInputs() {
  const rail = railSelectionFixture();
  const source = rail.inputs[0]!.evidence;
  const origin = { name: "A", ref: { provider: "timetable", providerPlaceId: "synthetic-station-a" }, sources: [source] };
  const destination = { name: "C", ref: { provider: "timetable", providerPlaceId: "synthetic-station-c" }, sources: [source] };
  const request = { constraints: [
    requestConstraint({ type: "origin", place: origin }, { id: "origin" }),
    requestConstraint({ type: "dates", start: { earliest: "2026-09-13", latest: "2026-09-13" } }, { id: "dates" }),
  ], assumptions: [] };
  const facts: Pick<CandidateAssessmentFacts, "places" | "dates"> = {
    places: assessedInformation({ origin, destinations: [destination], complete: true }, [source]),
    dates: assessedInformation({ startDate: "2026-09-13" }, [source]),
  };
  return { request, facts };
}
