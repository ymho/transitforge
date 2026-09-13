import { requestTrip, providerRequestPlace } from "./trip-request.fixture";
import type { ActivityItineraryItem, Trip, StayItineraryItem, TransportItineraryItem } from "./trip";
import { placeStay } from "./trip-places.fixture";
import { projectStaySchedule } from "./itinerary-schedule";
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

/** Ordinary selected overnight plan; exact hotel hours are deliberately absent. */
export function feasibilityStayTrip() {
  const original = placeStay("hotel", "宿");
  if (original.selection.status !== "selected") throw new Error("fixture");
  const stay: StayItineraryItem = { ...original, schedule: projectStaySchedule("2026-09-22", "2026-09-23", "Asia/Tokyo"),
    selection: { status: "selected", accommodation: { ...original.selection.accommodation,
      place: { ...original.selection.accommodation.place, timeZone: "Asia/Tokyo" } } } };
  const transport = (id: string, date: string): TransportItineraryItem => ({ id, title: "移動", type: "transport",
    schedule: { type: "fixed", startAt: feasibilityInstant(9, date), endAt: feasibilityInstant(11, date) },
    detail: { status: "selected", mode: "walk", origin: { name: "出発地", sources: [] }, destination: { name: "到着地", sources: [] }, provenance: { type: "manual" } } });
  const before = transport("outbound", "2026-09-22"), after = transport("return", "2026-09-23");
  const trip = requestTrip(undefined, [before, stay, after]);
  const facts: TripFeasibilityFacts = { ...feasibilityFacts(trip), external: [
    ...[before, after].map((item) => feasibilityObservation({ type: "transport", item, minimumMinutes: 60 })),
    feasibilityObservation({ type: "visit", item: stay, available: true, reservationRequired: false }),
    feasibilityObservation({ type: "movement", beforeItem: before, afterItem: stay, minimumMinutes: 30 }),
    feasibilityObservation({ type: "movement", beforeItem: stay, afterItem: after, minimumMinutes: 30 }),
  ] };
  return { trip, facts, stay, before, after };
}
