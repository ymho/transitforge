import type { TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";
import { validateTravelCandidateAssessment } from "@raiquora/trip/validate-candidate-assessment";
import type { TravelCandidate } from "@raiquora/trip/travel-candidate";

/** Bounded candidate identity, not rail Evidence or an adopted itinerary. No times or private offerings. */
export function candidateIdentityContext(candidate: Pick<TravelCandidate, "id"> & Partial<TravelCandidate>): Record<string, unknown> {
  return { id: candidate.id,
    ...(candidate.journey?.legs.length ? { originStation: candidate.journey.legs[0]!.originStation.slice(0, 120),
      destinationStation: candidate.journey.legs.at(-1)!.destinationStation.slice(0, 120) } : {}),
    names: [...(candidate.experiences ?? []), ...(candidate.accommodations ?? [])].slice(0, 4).map((offering) => offering.name.slice(0, 120)),
  };
}

/** Application-produced comparison, separate from currentTrip and realtime facts. */
export function candidateAssessmentContext(value: { candidate: Pick<TravelCandidate, "id"> & Partial<TravelCandidate>; assessment: TravelCandidateAssessment; comparison?: Record<string, unknown> }): Record<string, unknown> {
  const a = value.assessment;
  validateTravelCandidateAssessment(a);
  if (value.candidate.id !== a.candidateId) throw new Error("Candidate assessment identity mismatch");
  const { sources, ...assessment } = structuredClone(a);
  const identity = value.comparison ?? candidateIdentityContext(value.candidate);
  const comparison = Object.fromEntries(["originStation", "destinationStation", "serviceDate"].flatMap((key) =>
    typeof identity[key] === "string" ? [[key, identity[key].slice(0, 120)]] : []));
  return { candidate: { id: a.candidateId }, comparison: { ...comparison,
    names: Array.isArray(identity.names) ? identity.names.filter((v): v is string => typeof v === "string").slice(0, 4).map((v) => v.slice(0, 120)) : [] }, assessment: { ...assessment,
    sourceRefs: sources.map((s) => ({ evidenceId: s.id, kind: s.kind, provider: s.provider,
      ...(s.sourceId ? { sourceId: s.sourceId } : {}) })) },
    semantics: "derived-candidate-comparison-not-adopted-plan; unknown/unavailable are not favorable; not whole-trip feasibility" };
}
