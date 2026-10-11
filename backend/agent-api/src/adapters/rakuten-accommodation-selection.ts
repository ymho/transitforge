import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import type { AccommodationSelectionEvidence } from "@raiquora/trip/select-accommodation";

/** Application-approved itinerary reference and search-time display observations.
 * The user authorized reference images, ratings and booking links on 2026-10-11.
 * This is not a blanket grant to copy provider content. Rakuten's hotelNo identifies the actual facility;
 * generic product IDs and legacy unqualified providers cannot use this policy. */
export function rakutenAccommodationSelectionEvidence(offering: AccommodationOffering, retrievedAt: string): AccommodationSelectionEvidence | undefined {
  if (offering.provider !== "rakuten-travel" || !/^[1-9][0-9]*$/u.test(offering.providerItemId) ||
      !Number.isSafeInteger(Number(offering.providerItemId)) || !Number.isFinite(Date.parse(retrievedAt))) return undefined;
  const identity = { provider: offering.provider, sourceId: offering.providerItemId, retrievedAt,
    attribution: "楽天トラベル", confidence: "observed" as const };
  return { provider: offering.provider, providerItemId: offering.providerItemId, storageAllowed: true, priceRetention: "permitted", displayRetention: "permitted",
    source: { ...identity, id: `rakuten-travel:accommodation:${offering.providerItemId}`, kind: "accommodation" },
    place: { ref: { provider: offering.provider, providerPlaceId: offering.providerItemId }, name: offering.name,
      ...(Number.isFinite(offering.latitude) && Number.isFinite(offering.longitude) && Math.abs(offering.latitude!) <= 90 && Math.abs(offering.longitude!) <= 180 ? { coordinate: { latitude: offering.latitude!, longitude: offering.longitude! }, timeZone: "Asia/Tokyo" } : {}), capturedAt: retrievedAt,
      sources: [{ ...identity, id: `rakuten-travel:facility:${offering.providerItemId}`, kind: "place" }] },
    placeRetention: { origin: "provider", provider: offering.provider, storage: "permitted", allowedFields: ["ref", "name", "coordinate", "timeZone", "capturedAt", "sources"] } };
}
