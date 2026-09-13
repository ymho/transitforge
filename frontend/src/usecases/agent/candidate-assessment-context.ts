import type { TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";
import { validateTravelCandidateAssessment } from "@raiquora/trip/validate-candidate-assessment";

/** Application-produced comparison, separate from currentTrip and realtime facts. */
export function candidateAssessmentContext(value: { candidate: { id: string }; assessment: TravelCandidateAssessment }): Record<string, unknown> {
  const a = value.assessment;
  validateTravelCandidateAssessment(a);
  if (value.candidate.id !== a.candidateId) throw new Error("Candidate assessment identity mismatch");
  const { sources, ...assessment } = structuredClone(a);
  return { candidate: { id: a.candidateId }, assessment: { ...assessment,
    sourceRefs: sources.map((s) => ({ evidenceId: s.id, kind: s.kind, provider: s.provider,
      ...(s.sourceId ? { sourceId: s.sourceId } : {}) })) },
    semantics: "derived-candidate-comparison-not-adopted-plan; unknown/unavailable are not favorable; not whole-trip feasibility" };
}
