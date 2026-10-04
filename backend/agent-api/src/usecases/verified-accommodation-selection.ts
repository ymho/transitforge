import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import { selectAccommodation, type AccommodationSelectionEvidence } from "@raiquora/trip/select-accommodation";
import { projectStaySchedule } from "@raiquora/trip/itinerary-schedule";
import type { ItineraryItem } from "@raiquora/trip/trip";

/** The same proven facility/product/retention boundary as screen selection.
 * An Offering alone or a model-declared permission never authorizes persistence. */
export function verifiedAccommodationSelectionItems(offerings: readonly AccommodationOffering[],
  proofs: readonly AccommodationSelectionEvidence[], retrievedAt: string): ItineraryItem[] {
  return offerings.slice(0, 5).flatMap(offering => {
    const matches = proofs.filter(proof => proof.provider === offering.provider && proof.providerItemId === offering.providerItemId);
    if (matches.length !== 1 || !matches[0]!.storageAllowed) return [];
    const accommodation = selectAccommodation(offering, matches[0]!, retrievedAt);
    return [{ id: `hotel:${offering.providerItemId}`, title: offering.name, type: "stay" as const,
      schedule: projectStaySchedule(offering.checkInDate, offering.checkOutDate, accommodation.place.timeZone),
      selection: { status: "selected" as const, accommodation } }];
  });
}
