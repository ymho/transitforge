import type { TravelCandidate } from "@raiquora/trip/travel-candidate";
import type { CandidateAssessmentFacts } from "@raiquora/trip/travel-candidate-assessment";
import { selectAccommodation, type AccommodationSelectionEvidence } from "./select-accommodation";
import { selectRailJourney, projectRailSchedule, validInstant, exactKeys, type RailTimetableInput, type VerifiedRailCandidate } from "@raiquora/trip/selected-rail-journey";
import { projectStaySchedule } from "@raiquora/trip/itinerary-schedule";
import { applyTripProposal, type Trip, type TripUpdateProposal, type ItineraryItem } from "@raiquora/trip/trip";

/** Task-local lookup metadata. This is not a new candidate model or persistent Repository. */
export interface CandidateSelectionPort {
  resolve(candidateId: string): Promise<{
    candidate: TravelCandidate;
    tripId: string;
    taskId: string;
    validUntil: string;
    rail?: VerifiedRailCandidate;
    /** Already acquired, candidate-bound observations. Assessment never calls loadTimetables/search. */
    assessmentFacts?: CandidateAssessmentFacts;
    /** Adapter-reviewed storage permission and evidence; an Offering alone is not permission. */
    accommodation?: AccommodationSelectionEvidence;
  } | undefined>;
  loadTimetables(rail: VerifiedRailCandidate): Promise<readonly RailTimetableInput[]>;
}

export interface CandidateSelectionRequest {
  candidateId: string;
  itemId: string;
  taskId: string;
  accommodation?: { provider: string; providerItemId: string };
}

/** No candidate body/provenance is accepted from UI or AI. Both provide identifiers only. */
export async function proposeCandidateSelection(
  trip: Trip, request: CandidateSelectionRequest, port: CandidateSelectionPort, selectedAt: string,
): Promise<TripUpdateProposal> {
  exactKeys(request, ["candidateId", "itemId", "taskId", "accommodation"]);
  if ([request.candidateId, request.itemId, request.taskId].some((id) => typeof id !== "string" || !id.trim())) throw new Error("Selection IDs required");
  if (request.accommodation) exactKeys(request.accommodation, ["provider", "providerItemId"]);
  const target = trip.items.find(({ id }) => id === request.itemId);
  if (!target) throw new Error("Unknown target item");
  const resolved = await port.resolve(request.candidateId);
  if (!resolved || resolved.candidate.id !== request.candidateId || resolved.tripId !== trip.id ||
      resolved.taskId !== request.taskId || !validInstant(selectedAt) || !validInstant(resolved.validUntil) ||
      Date.parse(selectedAt) > Date.parse(resolved.validUntil)) throw new Error("Candidate is missing, expired or outside this task");
  let item: ItineraryItem;
  if (target.type === "transport") {
    if (request.accommodation || !resolved.rail || resolved.rail.candidateId !== resolved.candidate.id ||
        !resolved.candidate.journey || JSON.stringify(resolved.rail.journey) !== JSON.stringify(resolved.candidate.journey)) {
      throw new Error("Candidate has no verified rail selection");
    }
    const journey = selectRailJourney(resolved.rail, await port.loadTimetables(resolved.rail), selectedAt);
    item = { id: target.id, title: target.title, type: "transport", schedule: projectRailSchedule(journey), detail: { mode: "rail", status: "selected", journey } };
  } else if (target.type === "stay") {
    const key = request.accommodation;
    const permission = resolved.accommodation;
    if (!key || !permission?.storageAllowed || permission.provider !== key.provider || permission.providerItemId !== key.providerItemId) {
      throw new Error("Accommodation storage permission is missing");
    }
    const offerings = resolved.candidate.accommodations.filter((value) => value.provider === key.provider && value.providerItemId === key.providerItemId);
    if (offerings.length !== 1) throw new Error("Accommodation identity is missing or ambiguous");
    const offering = offerings[0]!;
    const accommodation = selectAccommodation(offering, permission, selectedAt);
    // Neutral item label; the selected facility's name belongs only to the snapshot.
    item = { id: target.id, title: "宿泊", type: "stay",
      schedule: projectStaySchedule(accommodation.checkInDate, accommodation.checkOutDate, accommodation.place.timeZone),
      selection: { status: "selected", accommodation } };
  } else throw new Error("Use the activity adoption boundary for this item");
  const proposal: TripUpdateProposal = { tripId: trip.id, baseRevision: trip.revision, summary: `${item.title}の候補を採用`,
    patches: [{ type: "replace", itemId: target.id, item },
      { type: "planning", state: trip.planningState === "itinerary_refinement" ? "itinerary_refinement" : "itinerary_draft" }] };
  applyTripProposal(trip, proposal); // Validate only. No state/storage change before explicit confirmation.
  return proposal;
}

/** Explicit confirmation re-resolves task/expiry and timetable facts; it still performs no persistence. */
export async function confirmCandidateSelection(
  trip: Trip, request: CandidateSelectionRequest, shown: TripUpdateProposal,
  port: CandidateSelectionPort, confirmedAt: string,
): Promise<Trip> {
  applyTripProposal(trip, shown); // Reject stale revisions before resolving the candidate again.
  const checked = await proposeCandidateSelection(trip, request, port, confirmedAt);
  // selectedAt is the confirmation time, not when the preview was prepared.
  // Any other changed fact needs a new preview/confirmation, never a silent candidate replacement.
  const comparable = (proposal: TripUpdateProposal): string => JSON.stringify(proposal,
    (key, value: unknown) => key === "selectedAt" ? undefined : value);
  if (comparable(shown) !== comparable(checked)) throw new Error("Candidate changed; review the proposal again");
  return applyTripProposal(trip, checked);
}
