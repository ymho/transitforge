import type { Trip, TripUpdateProposal } from "@raiquora/trip/trip";
import type { NonRailTransportMode } from "@raiquora/trip/transport-detail";
import { nonRailTransportModes } from "@raiquora/trip/transport-detail";
import { createPlaceSnapshot, copyPlaceSource, validatePlaceSource, type PlaceSnapshot, type PlaceSnapshotRetention } from "@raiquora/trip/place-snapshot";
import type { ExternalSourceEvidence } from "@raiquora/trip/external-travel-information";
import { validateItinerarySchedule, type ItinerarySchedule } from "@raiquora/trip/itinerary-schedule";
import { exactKeys, validInstant } from "@raiquora/trip/selected-rail-journey";
import { proposeItineraryItem, type ItineraryPlacement } from "./itinerary-proposal";

/** A transient, Adapter-verified resolution record, not a new persistent Offering or Trip. */
export interface ResolvedTransportCandidate {
  candidateId: string; tripId: string; taskId: string; validUntil: string;
  mode: NonRailTransportMode; title: string; provider: string; providerItemId: string;
  origin: PlaceSnapshot; destination: PlaceSnapshot; schedule: ItinerarySchedule;
  source: ExternalSourceEvidence;
  originRetention: PlaceSnapshotRetention; destinationRetention: PlaceSnapshotRetention;
  retainIdentity: boolean; retainSource: boolean; retainTitle: boolean; retainSchedule: boolean;
}
export interface TransportSelectionPort { resolve(candidateId: string): Promise<readonly ResolvedTransportCandidate[]>; }

/** Intent only. No Provider IDs, source claims or permission values accepted from the model. */
export function proposeManualTransport(trip: Trip, placement: ItineraryPlacement,
  input: { title: string; mode: NonRailTransportMode; origin: string; destination: string; schedule: ItinerarySchedule }): TripUpdateProposal {
  exactKeys(input, ["title", "mode", "origin", "destination", "schedule"]);
  if (!nonRailTransportModes.includes(input.mode)) throw new Error("Manual non-rail mode required");
  return proposeItineraryItem(trip, { id: placement.itemId, type: "transport", title: input.title, schedule: input.schedule,
    detail: { status: "selected", mode: input.mode,
      origin: createPlaceSnapshot({ name: input.origin, sources: [] }, { origin: "manual" }),
      destination: createPlaceSnapshot({ name: input.destination, sources: [] }, { origin: "manual" }), provenance: { type: "manual" } } }, placement);
}

/** Candidate ID -> trusted resolver -> scope/expiry/identity/retention -> allowlist -> Proposal.
 * Schedule is taken from the verified resolution, never overridden by model adoption input. */
export async function proposeTransportSelection(trip: Trip, placement: ItineraryPlacement,
  request: { candidateId: string; taskId: string }, port: TransportSelectionPort, selectedAt: string): Promise<TripUpdateProposal> {
  exactKeys(request, ["candidateId", "taskId"]);
  if (!request.candidateId?.trim() || !request.taskId?.trim()) throw new Error("Missing transport selection scope");
  const matches = await port.resolve(request.candidateId);
  if (matches.length !== 1) throw new Error("Transport candidate missing or ambiguous");
  const r = matches[0]!;
  const source = copyPlaceSource(r.source);
  validatePlaceSource(source);
  if (r.candidateId !== request.candidateId || r.tripId !== trip.id || r.taskId !== request.taskId ||
      !validInstant(selectedAt) || !validInstant(r.validUntil) || Date.parse(selectedAt) > Date.parse(r.validUntil) ||
      Date.parse(source.retrievedAt) > Date.parse(selectedAt) ||
      source.validFrom !== undefined && Date.parse(source.validFrom) > Date.parse(selectedAt) ||
      source.validUntil !== undefined && Date.parse(source.validUntil) < Date.parse(selectedAt) ||
      !r.provider?.trim() || r.provider === "manual" || !r.providerItemId?.trim() ||
      !["timetable", "web"].includes(source.kind) || source.provider !== r.provider || source.sourceId !== r.providerItemId ||
      !["observed", "provider-schedule"].includes(source.confidence) ||
      r.retainIdentity !== true || r.retainSource !== true || r.retainTitle !== true || r.retainSchedule !== true) {
    throw new Error("Transport identity, scope, freshness or retention is invalid");
  }
  const endpoint = (place: PlaceSnapshot, retention: PlaceSnapshotRetention): PlaceSnapshot => {
    if (retention.origin !== "provider" || !place.sources.some((s) => s.provider === retention.provider)) throw new Error("Verified transport endpoint required");
    const result = createPlaceSnapshot(place, retention);
    if (result.sources.some((s) => !["observed", "provider-schedule"].includes(s.confidence) || Date.parse(s.retrievedAt) > Date.parse(selectedAt) ||
        s.validFrom !== undefined && Date.parse(s.validFrom) > Date.parse(selectedAt) ||
        s.validUntil !== undefined && Date.parse(s.validUntil) < Date.parse(selectedAt))) throw new Error("Endpoint source is unverified or outside selection validity");
    return result;
  };
  // Validator rejects unknown fields before cloning; no volatile schedule extensions survive.
  validateItinerarySchedule(r.schedule);
  return proposeItineraryItem(trip, { id: placement.itemId, title: r.title, type: "transport", schedule: structuredClone(r.schedule),
    detail: { status: "selected", mode: r.mode, origin: endpoint(r.origin, r.originRetention), destination: endpoint(r.destination, r.destinationRetention),
      provenance: { type: "provider", provider: r.provider, providerItemId: r.providerItemId, selectedAt, sources: [source] } } }, placement);
}
