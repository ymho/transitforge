import { requestTrip, providerRequestPlace } from "./trip-request.fixture";
import type { ActivityItineraryItem, Trip } from "./trip";
import type { TripFeasibilityFact, TripFeasibilityFacts } from "./trip-feasibility-contract";
import type { ExternalTravelInformation } from "./external-travel-information";
export const feasibilityNow = "2026-09-13T00:00:00Z";
export const feasibilityInstant = (hour: number, date = "2026-09-14") => ({ at: `${date}T${String(hour).padStart(2, "0")}:00:00+09:00`, timeZone: "Asia/Tokyo" });
export function feasibilityActivity(id = "activity", start = 9, end = 10): ActivityItineraryItem {
  return { id, title: "散策", type: "activity", category: "free-time",
    place: providerRequestPlace(), schedule: { type: "fixed", startAt: feasibilityInstant(start), endAt: feasibilityInstant(end) } };
}
export const feasibilityTrip = () => requestTrip(undefined, [feasibilityActivity()]);
export const feasibilityFacts = (trip: Trip): TripFeasibilityFacts => ({ tripId: trip.id, tripRevision: trip.revision, reservations: [] });
export const feasibilityObservation = (data: TripFeasibilityFact): ExternalTravelInformation<TripFeasibilityFact> => ({
  status: "available", freshness: "fresh", data, evidence: [{ id: "verified-fact", kind: "web", provider: "synthetic", sourceId: "fixture",
    confidence: "observed", retrievedAt: "2026-09-12T00:00:00Z", validUntil: "2026-10-01T00:00:00Z" }],
});
