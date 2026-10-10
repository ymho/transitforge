import type { SelectedRailJourney } from "@raiquora/trip/selected-rail-journey";

/** Browser-only deep link. No request, redirect service, or click telemetry. */
export function e5489SearchLink(journey: SelectedRailJourney): string | undefined {
  const first = journey.legs[0], last = journey.legs.at(-1);
  if (!first || !last || !first.origin.name.trim() || !last.destination.name.trim()) return undefined;
  const departure = new Date(first.scheduledDeparture.at);
  if (!Number.isFinite(departure.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(departure);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  const url = new URL("https://e5489.jr-odekake.net/e5489/cspc/CBDayTimeArriveSelRsvMyDiaPC");
  url.search = new URLSearchParams({
    inputDepartStName: first.origin.name, inputArriveStName: last.destination.name,
    inputType: "0", inputDate: `${part("year")}${part("month")}${part("day")}`,
    inputHour: part("hour"), inputMinute: part("minute"), inputResultCount: "1",
    inputUniqueDepartSt: "1", inputUniqueArriveSt: "1", SequenceType: "0",
    inputReturnUrl: "/", encFlag: "1",
  }).toString();
  return url.href;
}
