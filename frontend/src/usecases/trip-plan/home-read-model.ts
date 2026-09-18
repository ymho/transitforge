import { classifyTrips, type ClassifiedTrip } from "@raiquora/trip/trip-adoption";
import type { Trip } from "@raiquora/trip/trip";
import type { TravelCandidateAssessment } from "@raiquora/trip/travel-candidate-assessment";
import { validateTravelCandidateAssessment } from "@raiquora/trip/validate-candidate-assessment";
import type { TripReadiness } from "@raiquora/trip/trip-readiness";

/** A read projection of existing sources, not a second Trip/Profile store. */
export interface HomeReadInput {
  state: "loading" | "available" | "unavailable" | "unauthenticated";
  trips: readonly Trip[];
  candidates: readonly { id: string; title: string; assessment?: TravelCandidateAssessment }[];
  readiness?: TripReadiness;
  preview?: boolean;
}
export function homeReadModel(input: HomeReadInput, now: Date) {
  const trips = input.state === "available" ? classifyTrips(input.trips, { now: () => now }) : [];
  const next = trips.find((row) => row.group === "current") ?? trips.find((row) => row.group === "next");
  const candidates = input.candidates.slice(0, 12).filter((candidate) => {
    if (!candidate.assessment || candidate.assessment.candidateId !== candidate.id) return false;
    try { validateTravelCandidateAssessment(candidate.assessment); return candidate.assessment.serviceCoverage?.status === "supported"; }
    catch { return false; }
  }).slice(0, 4);
  const readiness = next && input.readiness?.tripId === next.trip.id && input.readiness.tripRevision === next.trip.revision ? input.readiness : undefined;
  return { state: input.state, trips, next, candidates, readiness, preview: input.preview === true };
}
export const tripDisplayLabels: Record<ClassifiedTrip["group"], string> = {
  next: "次の旅", scheduled: "予定あり", current: "現在の旅行予定", planning: "計画中", "past-plan": "過去の予定", completed: "終了した旅", cancelled: "中止した旅",
};
