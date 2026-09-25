import { applyTripProposal, type Trip, type TripUpdateProposal } from "./trip";
import { validateTripRequest, type TripRequest, type TripConstraint } from "./trip-request";
import type { PlaceSnapshot } from "./place-snapshot";

/** Model interpretations remain unconfirmed. The caller supplies the authorized base Trip. */
export function proposeModelRequest(trip: Trip, request: TripRequest): TripUpdateProposal {
  validateTripRequest(request, trip.items);
  if (JSON.stringify(request.profileSuppressions) !== JSON.stringify(trip.request.profileSuppressions)) {
    throw new Error("Model cannot change Profile inheritance suppressions");
  }
  if (JSON.stringify(request.party) !== JSON.stringify(trip.request.party)) {
    if (trip.request.party) throw new Error("Model cannot rewrite known party");
    const a = request.assumptions.find((a) => a.id === request.party?.assumptionId);
    if (request.party?.source !== "assumption" || a?.source !== "model" || a.status !== "unconfirmed") throw new Error("Model party must be an unconfirmed assumption");
  }
  for (const c of trip.request.constraints) {
    if (!request.constraints.some((next) => JSON.stringify(c) === JSON.stringify(next))) throw new Error("Model cannot rewrite existing constraints");
  }
  for (const a of trip.request.assumptions) {
    if (!request.assumptions.some((next) => JSON.stringify(a) === JSON.stringify(next))) throw new Error("Model cannot confirm/reject existing assumptions");
  }
  for (const c of request.constraints.filter((c) => !trip.request.constraints.some(({ id }) => id === c.id))) {
    const a = request.assumptions.find(({ id }) => id === c.assumptionId);
    if (c.source !== "assumption" || a?.source !== "model" || a.status !== "unconfirmed") throw new Error("Model interpretation is not a user fact");
    validateModelRequirementPlaces(trip, c.requirement);
  }
  for (const a of request.assumptions.filter((a) => !trip.request.assumptions.some(({ id }) => id === a.id))) {
    if (a.source !== "model" || a.status !== "unconfirmed") throw new Error("Model assumption must be unconfirmed");
  }
  if (request.goal !== trip.request.goal) throw new Error("Model goal changes need explicit user adoption");
  const proposal: TripUpdateProposal = { tripId: trip.id, baseRevision: trip.revision,
    summary: "今回の旅行条件の仮置き案", patches: [{ type: "request", request }] };
  applyTripProposal(trip, proposal);
  return structuredClone(proposal);
}

/** Models may reuse adopted facts, but cannot mint Provider identities, evidence or coordinates. */
export function validateModelRequirementPlaces(trip: Trip, requirement: TripConstraint["requirement"]): void {
  for (const place of requirementPlaces(requirement)) {
    const nameOnly = Object.keys(place).every((key) => ["name", "ref", "sources"].includes(key)) &&
      (!place.ref || place.ref.provider === "manual") && place.sources.length === 0;
    if (!nameOnly && !adoptedPlaces(trip).some((known) => JSON.stringify(known) === JSON.stringify(place))) {
      throw new Error("New provider/place facts require trusted resolution, not model-authored evidence");
    }
  }
}

function requirementPlaces(requirement: TripConstraint["requirement"]): readonly PlaceSnapshot[] {
  if (requirement.type === "destinations") return requirement.places;
  return "place" in requirement ? [requirement.place] : [];
}
function adoptedPlaces(trip: Trip): readonly PlaceSnapshot[] {
  return [...trip.request.constraints.flatMap((c) => [...requirementPlaces(c.requirement)]), ...trip.items.flatMap((item) => {
    if (item.type === "activity") return item.place ? [item.place] : [];
    if (item.type === "stay") return item.selection.status === "selected" ? [item.selection.accommodation.place] : item.selection.place ? [item.selection.place] : [];
    return item.detail.status !== "selected" ? [] : item.detail.mode === "rail" ?
      item.detail.journey.legs.flatMap((leg) => [leg.origin, leg.destination]) : [item.detail.origin, item.detail.destination];
  })];
}
