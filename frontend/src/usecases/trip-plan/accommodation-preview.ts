import type { StayItineraryItem } from "@raiquora/trip/trip";
import { itineraryScheduleLabel } from "./itinerary-schedule-label";

/** Display adopted plan facts only. Selection is neither booked nor known unbooked. */
export function accommodationPreview(item: StayItineraryItem): string {
  if (item.selection.status === "unselected") return [item.selection.place?.name ?? item.title,
    itineraryScheduleLabel(item.schedule), "宿泊先未選択", ...plannedTimingCopy(item)].join("\n\n");
  const stay = item.selection.accommodation;
  return [stay.place.name, stay.place.area, stay.place.address,
    `${stay.checkInDate} チェックイン → ${stay.checkOutDate} チェックアウト`, "採用した宿泊先", ...plannedTimingCopy(item),
  ].filter(Boolean).join("\n\n");
}

function plannedTimingCopy(item: StayItineraryItem): string[] {
  return [item.plannedTiming?.checkIn ? `予定チェックイン: ${item.plannedTiming.checkIn.at} (${item.plannedTiming.checkIn.timeZone})` : undefined,
    item.plannedTiming?.checkOut ? `予定チェックアウト: ${item.plannedTiming.checkOut.at} (${item.plannedTiming.checkOut.timeZone})` : undefined].filter((v): v is string => !!v);
}
