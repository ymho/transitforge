import { validateTrip, type Trip } from "./trip";
import { samePlaceIdentity, type PlaceSnapshot } from "./place-snapshot";

/** An occurrence in the adopted plan, not evidence of a completed real-world visit. */
export interface TripPlaceOccurrence {
  readonly itemId: string;
  readonly role: "transport-origin" | "transport-destination" | "stay" | "activity";
  readonly legIndex?: number;
  readonly place: PlaceSnapshot;
}
export interface TripTransportEndpoints {
  readonly itemId: string;
  readonly legIndex?: number;
  readonly origin: PlaceSnapshot;
  readonly destination: PlaceSnapshot;
}
export interface TripPlaceProjection {
  readonly visitedPlaces: readonly TripPlaceOccurrence[];
  readonly overnightPlaces: readonly TripPlaceOccurrence[];
  readonly transportEndpoints: readonly TripTransportEndpoints[];
}

/** Exact item/leg order, including repeat visits and adjacent endpoints. No request/candidate input. */
export function projectTripPlaces(trip: Trip): TripPlaceProjection {
  validateTrip(trip);
  const visitedPlaces: TripPlaceOccurrence[] = [], overnightPlaces: TripPlaceOccurrence[] = [], transportEndpoints: TripTransportEndpoints[] = [];
  for (const item of trip.items) {
    if (item.type === "transport" && item.detail.status === "selected") {
      const legs = item.detail.mode === "rail"
        ? item.detail.journey.legs.map((leg, legIndex) => ({ origin: leg.origin, destination: leg.destination, legIndex }))
        : [{ origin: item.detail.origin, destination: item.detail.destination }];
      for (const leg of legs) {
        const index = "legIndex" in leg ? { legIndex: leg.legIndex } : {};
        transportEndpoints.push({ itemId: item.id, ...index, origin: leg.origin, destination: leg.destination });
        visitedPlaces.push({ itemId: item.id, ...index, role: "transport-origin", place: leg.origin },
          { itemId: item.id, ...index, role: "transport-destination", place: leg.destination });
      }
    } else if (item.type === "stay" && item.selection.status === "selected") {
      const occurrence: TripPlaceOccurrence = { itemId: item.id, role: "stay", place: item.selection.accommodation.place };
      visitedPlaces.push(occurrence); overnightPlaces.push(occurrence);
    } else if (item.type === "activity" && item.place) {
      visitedPlaces.push({ itemId: item.id, role: "activity", place: item.place });
    }
  }
  return structuredClone({ visitedPlaces, overnightPlaces, transportEndpoints });
}

/** Optional UI list only; never replaces the ordered occurrence view. Unknown identities stay separate. */
export function uniqueTripPlaces(places: readonly TripPlaceOccurrence[]): TripPlaceOccurrence[] {
  const unique: TripPlaceOccurrence[] = [];
  for (const entry of places) if (!unique.some((previous) => samePlaceIdentity(previous.place.ref, entry.place.ref))) unique.push(entry);
  return structuredClone(unique);
}
