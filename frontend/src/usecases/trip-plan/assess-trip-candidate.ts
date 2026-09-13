import { assessTravelCandidate } from "@raiquora/trip/assess-travel-candidate";
import { exactKeys, validInstant } from "@raiquora/trip/selected-rail-journey";
import type { Trip } from "@raiquora/trip/trip";
import type { CandidateSelectionPort } from "./select-trip-candidate";

/** Same task-local candidate resolver as adoption; IDs only. No new Repository or acquisition loop. */
export async function assessTripCandidate(trip: Trip, request: { candidateId: string; taskId: string; itemId?: string },
  port: CandidateSelectionPort, now: string) {
  exactKeys(request, ["candidateId", "taskId", "itemId"]);
  if (![request.candidateId, request.taskId].every((id) => typeof id === "string" && id.trim()) || !validInstant(now)) throw new Error("Invalid assessment request");
  const record = await port.resolve(request.candidateId);
  if (!record || record.tripId !== trip.id || record.taskId !== request.taskId || record.candidate.id !== request.candidateId ||
      !validInstant(record.validUntil) || Date.parse(record.validUntil) < Date.parse(now)) throw new Error("Candidate is missing, expired or outside this task");
  const assessment = assessTravelCandidate(trip, record.candidate, record.assessmentFacts ?? { candidateId: record.candidate.id }, now, request.itemId);
  // Only identity crosses the model boundary here, not a provider record, adoption or raw journey.
  return { candidate: { id: record.candidate.id }, assessment };
}
