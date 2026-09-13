import type { StayItineraryItem } from "@raiquora/trip/trip";
import { formatMoney } from "@raiquora/trip/money";
import { itineraryScheduleLabel } from "./itinerary-schedule-label";

/** Display adopted plan facts only. Selection is neither booked nor known unbooked. */
export function accommodationPreview(item: StayItineraryItem): string {
  if (item.selection.status === "unselected") return [item.selection.place?.name ?? item.title,
    itineraryScheduleLabel(item.schedule), "宿泊先未選択"].join("\n\n");
  const stay = item.selection.accommodation;
  return [stay.place.name, stay.place.area, stay.place.address,
    `${stay.checkInDate} チェックイン → ${stay.checkOutDate} チェックアウト`, "採用した宿泊先",
    stay.observedPrice ? `選択時の参考価格: ${formatMoney(stay.observedPrice.price)}（観測: ${stay.observedPrice.observedAt} / ${stay.observedPrice.basis ?? "価格条件未確認"}）` : undefined,
  ].filter(Boolean).join("\n\n");
}
