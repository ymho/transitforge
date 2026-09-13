import { createTrip, type ActivityItineraryItem, type StayItineraryItem, type TransportItineraryItem } from "./trip";
import type { PlaceSnapshot } from "./place-snapshot";
import { projectStaySchedule } from "./itinerary-schedule";

export const placesTripId = "11111111-1111-4111-8111-111111111111";
export const placesAt = "2026-09-12T08:00:00Z";
/** Synthetic retained places, not geocoded or real provider data. */
export function resolvedPlace(name: string, id = name, provider = "fixture-places"): PlaceSnapshot {
  return { name, ref: { provider, providerPlaceId: id }, sources: [
    { id: `source-${id}`, kind: "place", provider, sourceId: id, retrievedAt: placesAt, confidence: "observed" },
  ] };
}
export function placeActivity(id: string, place?: PlaceSnapshot): ActivityItineraryItem {
  return { id, title: place?.name ?? "自由時間", type: "activity", category: place ? "sightseeing" : "free-time",
    schedule: { type: "unscheduled" }, ...(place ? { place } : {}) };
}
export function placeTransport(id: string, origin: string, destination: string): TransportItineraryItem {
  return { id, title: "移動", type: "transport", schedule: { type: "unscheduled" }, detail: { status: "selected", mode: "walk",
    origin: { name: origin, sources: [] }, destination: { name: destination, sources: [] }, provenance: { type: "manual" } } };
}
export function placeStay(id: string, name: string): StayItineraryItem {
  return { id, title: "宿泊", type: "stay", schedule: projectStaySchedule("2026-09-22", "2026-09-23"), selection: {
    status: "selected", accommodation: { provider: "fixture-products", providerItemId: id, selectedAt: placesAt,
      checkInDate: "2026-09-22", checkOutDate: "2026-09-23", place: resolvedPlace(name),
      sources: [{ id: `product-${id}`, kind: "accommodation", provider: "fixture-products", sourceId: id, retrievedAt: placesAt, confidence: "observed" }] },
  } };
}
export function multiCityTrip() {
  return createTrip(placesTripId, "周遊", placesAt, [
    placeTransport("movement", "Vienna", "Salzburg"), placeStay("hotel", "Salzburgの宿"),
    placeActivity("activity", resolvedPlace("Zürich")),
  ], { constraints: [], assumptions: [] }, "itinerary_refinement", "オーストリア・スイス");
}
