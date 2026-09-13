import { applyTripProposal, type Trip, type TripUpdateProposal, type ItineraryItem } from "@raiquora/trip/trip";
import { exactKeys } from "@raiquora/trip/selected-rail-journey";

export type ItineraryPlacement = { itemId: string; afterId?: string; operation: "add" | "replace" };
/** Shared atomic preview boundary for adopted activities and transport. Never a writer. */
export function proposeItineraryItem(trip: Trip, item: ItineraryItem, placement: ItineraryPlacement): TripUpdateProposal {
  exactKeys(placement, ["itemId", "afterId", "operation"]);
  if (item.id !== placement.itemId || !["add", "replace"].includes(placement.operation) ||
      placement.operation === "replace" && placement.afterId !== undefined) throw new Error("Invalid itinerary placement");
  const proposal: TripUpdateProposal = { tripId: trip.id, baseRevision: trip.revision, summary: `${item.title}を旅程へ${placement.operation === "add" ? "追加" : "変更"}する案`, patches: [
    placement.operation === "add" ? { type: "add", item, ...(placement.afterId !== undefined ? { afterId: placement.afterId } : {}) }
      : { type: "replace", itemId: placement.itemId, item },
    { type: "planning", state: trip.planningState === "itinerary_draft" || trip.planningState === "itinerary_refinement" ? "itinerary_refinement" : "itinerary_draft" },
  ] };
  applyTripProposal(trip, proposal);
  return structuredClone(proposal);
}
