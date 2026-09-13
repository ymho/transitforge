import { createTravelCandidate } from "@raiquora/trip/travel-candidate";
import type { CandidateSelectionPort } from "./select-trip-candidate";

/** Synthetic permission grant, not a statement about any real Provider's retention rights. */
export function accommodationSelectionFixture(tripId: string, productId = "hotel-a", name = "評価用の宿A"): NonNullable<Awaited<ReturnType<CandidateSelectionPort["resolve"]>>> {
  const source = { id: "offering-source", kind: "accommodation" as const, provider: "fixture", sourceId: productId,
    retrievedAt: "2026-09-12T07:55:00Z", confidence: "observed" as const, validUntil: "2026-09-12T09:00:00Z" };
  const placeSource = { id: "facility-source", kind: "place" as const, provider: "facility", sourceId: `place-${productId}`,
    retrievedAt: "2026-09-12T07:50:00Z", confidence: "observed" as const };
  return { tripId, taskId: "task-a", validUntil: "2026-09-12T09:00:00Z",
    candidate: createTravelCandidate({ id: "candidate-a", accommodations: [{ kind: "accommodation", provider: "fixture", providerItemId: productId, name,
      checkInDate: "2026-09-22", checkOutDate: "2026-09-24", price: { price: { amountMinor: 12000, currency: "JPY" }, observedAt: "2026-09-12T07:55:00Z" }, availability: "available",
      bookingUrl: "https://example.com/book", imageUrl: "https://example.com/photo", reviewAverage: 4.5, reviewCount: 55 }] }),
    accommodation: { provider: "fixture", providerItemId: productId, storageAllowed: true, source,
      place: { ref: { provider: "facility", providerPlaceId: `place-${productId}` }, name, area: "評価用エリア", address: "評価用住所",
        timeZone: "Asia/Tokyo", capturedAt: placeSource.retrievedAt, sources: [placeSource] },
      placeRetention: { origin: "provider", provider: "facility", storage: "permitted", allowedFields: ["ref", "name", "area", "address", "timeZone", "capturedAt", "sources"] } } };
}
