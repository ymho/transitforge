import type { Trip } from "@raiquora/trip/trip";
import { projectTripPlaces } from "@raiquora/trip/trip-places";

/** Planned occurrences in item order. Labels are not city/country classification or visit history. */
export function tripPlacesPreview(trip: Trip): string {
  const places = projectTripPlaces(trip);
  return [trip.summaryDestination,
    "訪問予定: " + (places.visitedPlaces.map((entry) => entry.place.name).join(" → ") || "未採用"),
    "宿泊予定: " + (places.overnightPlaces.map((entry) => entry.place.name).join(" / ") || "未選択"),
  ].filter(Boolean).join("\n\n");
}
