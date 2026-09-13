import type { ResolvedActivityCandidate } from "./propose-trip-activity";

/** Synthetic provider data and explicit test-only permission, not a real Provider grant. */
export function activityCandidateFixture(tripId: string, kind: "restaurant" | "experience" = "restaurant"): ResolvedActivityCandidate {
  const source = { id: "activity-evidence", kind: kind === "restaurant" ? "restaurant" as const : "event" as const,
    provider: "fixture", sourceId: kind === "restaurant" ? "restaurant-a" : "experience-a", retrievedAt: "2026-09-12T07:55:00Z", confidence: "observed" as const };
  const common = { candidateId: "activity-a", tripId, taskId: "task-a", validUntil: "2026-09-13T08:00:00Z", provider: "fixture",
    providerItemId: source.sourceId, source, retainTitle: true, retainSchedule: true,
    place: { name: "評価用の森の食堂", ref: { provider: "fixture", providerPlaceId: "restaurant-a" }, sources: [source] },
    placeRetention: { origin: "provider" as const, provider: "fixture", storage: "permitted" as const,
      allowedFields: ["ref", "name", "sources"] as const } };
  return kind === "restaurant" ? { ...common, kind, result: { providerRestaurantId: "restaurant-a", name: "評価用の森の食堂",
    detailUrl: "https://example.com/restaurant", imageUrl: "https://example.com/image", genre: "PROVIDER_G01", budget: "2000円", openingHours: "毎日" } }
    : { ...common, kind, result: { kind: "experience", provider: "fixture", providerItemId: "experience-a", name: "評価用の森の料理体験",
      startDate: "2026-09-22", price: { price: { amountMinor: 1000, currency: "JPY" }, observedAt: "2026-09-12T07:55:00Z" }, bookingUrl: "https://example.com/booking" } };
}
