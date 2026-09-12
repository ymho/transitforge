import type { StayItineraryItem } from "@raiquora/trip/trip";
import { itineraryScheduleLabel } from "./itinerary-schedule-label";

/** Display adopted plan facts only. Selection is neither booked nor known unbooked. */
export function accommodationPreview(item: StayItineraryItem): string {
  if (item.selection.status === "unselected") return [item.selection.place?.name ?? item.title,
    itineraryScheduleLabel(item.schedule), "宿泊先未選択"].join("\n\n");
  const stay = item.selection.accommodation;
  return [stay.place.name, stay.place.area, stay.place.address,
    `${stay.checkInDate} チェックイン → ${stay.checkOutDate} チェックアウト`, "採用した宿泊先"].filter(Boolean).join("\n\n");
}
