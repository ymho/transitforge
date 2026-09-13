import type { Trip } from "@raiquora/trip/trip";
import { projectTripPlaces, type TripPlaceOccurrence } from "@raiquora/trip/trip-places";
import type { PlaceSnapshot } from "@raiquora/trip/place-snapshot";

type ContextPlace = Pick<PlaceSnapshot, "name" | "ref" | "area">;
type ContextOccurrence = Pick<TripPlaceOccurrence, "itemId" | "role" | "legIndex"> & { place: ContextPlace };
export interface AgentTripPlaces {
  itineraryPlaces: {
    visitedPlaces: ContextOccurrence[];
    overnightPlaces: ContextOccurrence[];
    transportEndpoints: Array<{ itemId: string; legIndex?: number; origin: ContextPlace; destination: ContextPlace }>;
  };
  placesTruncated: boolean;
  placeSemantics: string;
}

/** Bounded read projection, not a second Place model or a geographic classifier. */
export function agentTripPlaces(trip: Trip): AgentTripPlaces {
  const projection = projectTripPlaces(trip), limit = 24;
  let placesTruncated = Object.values(projection).some((entries) => entries.length > limit);
  const text = (value: string): string => {
    if (value.length > 100) placesTruncated = true;
    return value.slice(0, 100);
  };
  const place = (value: PlaceSnapshot): ContextPlace => {
    const refFits = value.ref && Object.values(value.ref).every((v) => v === undefined || v.length <= 256);
    if (value.ref && !refFits) placesTruncated = true;
    return { name: text(value.name), ...(value.area === undefined ? {} : { area: text(value.area) }),
      // Never truncate opaque identity into another valid-looking ID.
      ...(refFits ? { ref: structuredClone(value.ref) } : {}) };
  };
  const occurrence = (entry: TripPlaceOccurrence): ContextOccurrence => ({ itemId: entry.itemId, role: entry.role,
    ...(entry.legIndex === undefined ? {} : { legIndex: entry.legIndex }), place: place(entry.place) });
  const itineraryPlaces = {
    visitedPlaces: projection.visitedPlaces.slice(0, limit).map(occurrence),
    overnightPlaces: projection.overnightPlaces.slice(0, limit).map(occurrence),
    transportEndpoints: projection.transportEndpoints.slice(0, limit).map((entry) => ({ itemId: entry.itemId,
      ...(entry.legIndex === undefined ? {} : { legIndex: entry.legIndex }), origin: place(entry.origin), destination: place(entry.destination) })),
  };
  return { itineraryPlaces, placesTruncated,
    placeSemantics: "request.constraints[].requirement(type=destinations) are wishes; itineraryPlaces are ordered adopted plan occurrences, not completed visits; summaryDestination is display-only; truncated lists are incomplete" };
}
