import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import type { AccommodationSelectionEvidence } from "@raiquora/trip/select-accommodation";

/** Application-approved minimal itinerary reference. This is not a blanket grant
 * to copy provider content. Rakuten's hotelNo identifies the actual facility;
 * generic product IDs and legacy unqualified providers cannot use this policy. */
export function rakutenAccommodationSelectionEvidence(offering: AccommodationOffering, retrievedAt: string): AccommodationSelectionEvidence | undefined {
  if (offering.provider !== "rakuten-travel" || !/^[1-9][0-9]*$/u.test(offering.providerItemId) ||
      !Number.isSafeInteger(Number(offering.providerItemId)) || !Number.isFinite(Date.parse(retrievedAt))) return undefined;
  const identity = { provider: offering.provider, sourceId: offering.providerItemId, retrievedAt,
    attribution: "楽天トラベル", confidence: "observed" as const };
  return { provider: offering.provider, providerItemId: offering.providerItemId, storageAllowed: true, priceRetention: "permitted",
    source: { ...identity, id: `rakuten-travel:accommodation:${offering.providerItemId}`, kind: "accommodation" },
    place: { ref: { provider: offering.provider, providerPlaceId: offering.providerItemId }, name: offering.name, capturedAt: retrievedAt,
      sources: [{ ...identity, id: `rakuten-travel:facility:${offering.providerItemId}`, kind: "place" }] },
    placeRetention: { origin: "provider", provider: offering.provider, storage: "permitted", allowedFields: ["ref", "name", "capturedAt", "sources"] } };
}
