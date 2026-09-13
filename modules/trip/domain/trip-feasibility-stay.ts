import type { ItineraryItem } from "./trip";
import type { ZonedInstant } from "./itinerary-schedule";

export function isSelectedStay(item: ItineraryItem): boolean {
  return item.type === "stay" && item.selection.status === "selected" && item.schedule.type === "day";
}
export function dateInZone(at: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** A stay is a location/date span, not an appointment occupying the span. Activities and
 * excursions within it are valid. Only dates outside the whole span prove reversed order.
 * No check-in/out hours or midnight instants are manufactured.
 */
export function stayDateRelation(before: ItineraryItem, after: ItineraryItem, minimumMinutes = 0): "violated" | "precision" | "unknown" {
  const incoming = isSelectedStay(after);
  const stay = incoming ? after : before, other = incoming ? before : after;
  if (!isSelectedStay(stay) || stay.schedule.type !== "day" || !stay.schedule.timeZone || other.schedule.type !== "fixed" || !other.schedule.endAt) return "unknown";
  const instant = incoming ? other.schedule.endAt : other.schedule.startAt;
  const shifted = new Date(Date.parse(instant.at) + (incoming ? 1 : -1) * minimumMinutes * 60_000);
  if (!Number.isFinite(shifted.getTime())) return "unknown";
  const date = dateInZone(shifted.toISOString(), stay.schedule.timeZone);
  // Checkout day itself remains possible: its exact hour is not part of the snapshot.
  return (incoming ? date > (stay.schedule.endDate ?? stay.schedule.date) : date < stay.schedule.date) ? "violated" : "precision";
}
export function stayReservationDateConflict(item: ItineraryItem, startsAt?: ZonedInstant, endsAt?: ZonedInstant): boolean {
  if (!isSelectedStay(item) || item.schedule.type !== "day" || !item.schedule.timeZone) return false;
  return Boolean(startsAt && dateInZone(startsAt.at, item.schedule.timeZone) !== item.schedule.date ||
    endsAt && dateInZone(endsAt.at, item.schedule.timeZone) !== item.schedule.endDate);
}
