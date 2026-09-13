import type { AccommodationOffering } from "@raiquora/trip/travel-candidate";
import { isPriceObservation, copyPriceObservation } from "@raiquora/trip/money";
import type { ExternalSourceEvidence } from "@raiquora/trip/external-travel-information";
import { createPlaceSnapshot, copyPlaceSource, validatePlaceSource, type PlaceSnapshot, type PlaceSnapshotRetention } from "@raiquora/trip/place-snapshot";
import { validateAccommodationSnapshot, type AccommodationSnapshot } from "@raiquora/trip/accommodation-snapshot";

/** Short-lived trusted resolver metadata. Not model input, a Repository or another Offering. */
export interface AccommodationSelectionEvidence {
  provider: string;
  providerItemId: string;
  /** Permission to retain product identity, stay dates and durable source, not volatile data. */
  storageAllowed: boolean;
  /** Trusted permission bound to this product's quoted price; never accepted from model input. */
  priceRetention?: "permitted" | "forbidden" | "unknown";
  /** Facility identity is resolved independently of the product ID. No name-based matching here. */
  place: PlaceSnapshot;
  placeRetention: PlaceSnapshotRetention;
  source: ExternalSourceEvidence;
}

/** An Offering alone cannot authorize a snapshot. Trip/task/expiry is checked by the caller. */
export function selectAccommodation(offering: AccommodationOffering, proof: AccommodationSelectionEvidence, selectedAt: string): AccommodationSnapshot {
  if (offering.kind !== "accommodation" || proof.storageAllowed !== true || offering.provider !== proof.provider ||
      offering.providerItemId !== proof.providerItemId || !proof.placeRetention || proof.placeRetention.origin !== "provider") {
    throw new Error("Accommodation storage permission is missing; provider data cannot be manual");
  }
  const ref = proof.place.ref;
  if (ref?.providerPlaceId !== undefined && !proof.place.sources.some((source) =>
    source.provider === ref.provider && source.sourceId === ref.providerPlaceId)) throw new Error("Accommodation facility evidence does not match");
  const place = createPlaceSnapshot(proof.place, proof.placeRetention);
  // Resolved place evidence belongs to the facility provider, not necessarily the product provider.
  for (const source of place.sources) {
    validatePlaceSource(source);
    if (!["observed", "provider-schedule"].includes(source.confidence) ||
        Date.parse(source.retrievedAt) > Date.parse(selectedAt) ||
        source.observedAt !== undefined && Date.parse(source.observedAt) > Date.parse(source.retrievedAt) ||
        source.validFrom !== undefined && Date.parse(source.validFrom) > Date.parse(selectedAt) ||
        source.validUntil !== undefined && Date.parse(source.validUntil) < Date.parse(selectedAt)) throw new Error("Unverified accommodation place");
  }
  const snapshot: AccommodationSnapshot = { provider: offering.provider, providerItemId: offering.providerItemId,
    place, selectedAt, checkInDate: offering.checkInDate, checkOutDate: offering.checkOutDate,
    sources: [copyPlaceSource(proof.source)],
    ...(proof.priceRetention === "permitted" && isPriceObservation(offering.price) &&
      Date.parse(offering.price.observedAt) <= Date.parse(proof.source.retrievedAt) &&
      Date.parse(offering.price.observedAt) <= Date.parse(selectedAt)
      ? { observedPrice: copyPriceObservation(offering.price) } : {}) };
  validateAccommodationSnapshot(snapshot);
  return snapshot;
}
