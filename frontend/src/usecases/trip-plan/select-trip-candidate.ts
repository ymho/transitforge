import type { TravelCandidate } from "@raiquora/trip/travel-candidate";
import type { ExternalSourceEvidence } from "@raiquora/trip/external-travel-information";
import { createPlaceSnapshot, type PlaceSnapshotRetention } from "@raiquora/trip/place-snapshot";
import { selectRailJourney, projectRailSchedule, validInstant, type RailTimetableInput, type VerifiedRailCandidate } from "@raiquora/trip/selected-rail-journey";
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
    /** Adapter-reviewed storage permission and evidence; an Offering alone is not permission. */
    accommodation?: { provider: string; providerItemId: string; storageAllowed: boolean;
      placeRetention: PlaceSnapshotRetention; source: ExternalSourceEvidence };
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
  } else {
    const key = request.accommodation;
    const permission = resolved.accommodation;
    if (!key || !permission?.storageAllowed || permission.provider !== key.provider || permission.providerItemId !== key.providerItemId) {
      throw new Error("Accommodation storage permission is missing");
    }
    const offerings = resolved.candidate.accommodations.filter((value) => value.provider === key.provider && value.providerItemId === key.providerItemId);
    if (offerings.length !== 1) throw new Error("Accommodation identity is missing or ambiguous");
    const offering = offerings[0]!;
    const source = permission.source;
    if (source.provider !== offering.provider || source.sourceId !== offering.providerItemId) throw new Error("Accommodation evidence does not match");
    item = { id: target.id, title: target.title, type: "stay", schedule: projectStaySchedule(offering.checkInDate, offering.checkOutDate), selection: { status: "selected", accommodation: {
      place: createPlaceSnapshot({
        ref: { provider: offering.provider, providerPlaceId: offering.providerItemId }, name: offering.name,
        ...(offering.address !== undefined ? { address: offering.address } : {}),
        ...(offering.areaName !== undefined ? { area: offering.areaName } : {}),
        ...(offering.longitude !== undefined && offering.latitude !== undefined
          ? { coordinate: { longitude: offering.longitude, latitude: offering.latitude } } : {}),
        capturedAt: source.retrievedAt, sources: [source],
      }, permission.placeRetention),
      checkInDate: offering.checkInDate, checkOutDate: offering.checkOutDate, selectedAt,
      sources: [{ id: source.id, kind: source.kind, provider: source.provider, sourceId: source.sourceId,
        retrievedAt: source.retrievedAt, confidence: source.confidence }],
    } } };
  }
  const proposal: TripUpdateProposal = { tripId: trip.id, summary: `${target.title}の候補を採用`,
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
  const checked = await proposeCandidateSelection(trip, request, port, confirmedAt);
  // selectedAt is the confirmation time, not when the preview was prepared.
  // Any other changed fact needs a new preview/confirmation, never a silent candidate replacement.
  const comparable = (proposal: TripUpdateProposal): string => JSON.stringify(proposal,
    (key, value: unknown) => key === "selectedAt" ? undefined : value);
  if (comparable(shown) !== comparable(checked)) throw new Error("Candidate changed; review the proposal again");
  return applyTripProposal(trip, checked);
}
