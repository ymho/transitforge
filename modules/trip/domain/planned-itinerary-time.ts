import { validateZonedInstant, type ZonedInstant } from "./itinerary-schedule";
import { exactKeys } from "./snapshot-validation";

/** User's intended arrival/departure only; neither hotel policy nor booking confirmation. */
export interface StayPlannedTiming {
  readonly checkIn?: ZonedInstant;
  readonly checkOut?: ZonedInstant;
}
export function validateStayPlannedTiming(value: StayPlannedTiming, dates: { checkInDate?: string; checkOutDate?: string; timeZone?: string }): void {
  exactKeys(value, ["checkIn", "checkOut"]);
  if (!value.checkIn && !value.checkOut) throw new Error("Stay planned time required");
  for (const [instant, date] of [[value.checkIn, dates.checkInDate], [value.checkOut, dates.checkOutDate]] as const) {
    if (!instant) continue;
    validateZonedInstant(instant);
    if (!date || instant.at.slice(0, 10) !== date || dates.timeZone && instant.timeZone !== dates.timeZone) throw new Error("Stay planned time differs from stay dates/zone");
  }
  if (value.checkIn && value.checkOut && Date.parse(value.checkOut.at) < Date.parse(value.checkIn.at)) throw new Error("Checkout precedes checkin");
}
