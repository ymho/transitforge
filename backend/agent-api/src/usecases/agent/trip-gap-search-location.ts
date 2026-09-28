import type { ItineraryItem } from "@raiquora/trip/trip";
import type { PlaceSnapshot } from "@raiquora/trip/place-snapshot";

/** A saved location at the relevant edge of an authored item; not a live or verified position. */
export function placeAtTripItemEdge(item: ItineraryItem, edge: "before" | "after"): PlaceSnapshot | undefined {
  if (item.type === "activity") return item.place;
  if (item.type === "stay") return item.selection.status === "selected" ? item.selection.accommodation.place : item.selection.place;
  if (item.detail.status !== "selected") return undefined;
  if (item.detail.mode !== "rail") return edge === "after" ? item.detail.destination : item.detail.origin;
  // Station names are not geocoded PlaceSnapshots; do not invent an area or center.
  return undefined;
}
