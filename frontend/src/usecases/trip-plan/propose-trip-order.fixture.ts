import { createTrip } from "@raiquora/trip/trip";
import { placeActivity, placesAt, placesTripId } from "../../../../modules/trip/domain/trip-places.fixture";
export function orderTrip() {
  return createTrip(placesTripId, "予定", placesAt, [
    { ...placeActivity("a"), schedule: { type: "fixed", startAt: { at: "2026-09-22T10:00:00+09:00", timeZone: "Asia/Tokyo" }, endAt: { at: "2026-09-22T11:00:00+09:00", timeZone: "Asia/Tokyo" } } },
    { ...placeActivity("b"), schedule: { type: "day", date: "2026-09-22", timeZone: "Asia/Tokyo" } },
    { ...placeActivity("c"), schedule: { type: "day", date: "2026-09-23", timeZone: "Asia/Tokyo" } },
  ]);
}
