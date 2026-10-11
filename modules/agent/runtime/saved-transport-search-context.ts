import type { ItineraryItem, Trip } from "@raiquora/trip/trip";
import type { TripConstraint } from "@raiquora/trip/trip-request";
import { bindRelativeSchedule } from "@raiquora/trip/itinerary-schedule";
import { stableContractHash } from "./output-contract";

/** Saved labels are search inputs, not verified stations or a chosen route. */
export function savedTransportEndpoints(item: ItineraryItem): { origin: string; destination: string; provisional: boolean } | undefined {
  if (item.type !== "transport") return undefined;
  if (item.detail.status === "selected") {
    const detail = item.detail;
    return detail.mode === "rail"
      ? { origin: detail.journey.legs[0]!.origin.name, destination: detail.journey.legs.at(-1)!.destination.name, provisional: false }
      : { origin: detail.origin.name, destination: detail.destination.name, provisional: false };
  }
  // Only an explicit, single arrow pair. Do not interpret prose or a multi-stop route.
  const title = item.title.normalize("NFKC").trim().replace(/\s*\(\d{1,2}:\d{2}(?:頃)?(?:着|到着|発|出発)(?:予定)?\)\s*$/u, "");
  const match = /^([^→⇒\r\n]{1,120}?)\s*[→⇒]\s*([^→⇒\r\n]{1,120})$/u.exec(title);
  if (!match) return undefined;
  const origin = match[1]!.trim(), destination = match[2]!.trim();
  const valid = (value: string) => !!value && !/[()。、:：!?！？]/u.test(value) &&
    !/^(?:未定|不明|未設定|未選択|出発地|到着地|目的地|駅)$/u.test(value);
  return valid(origin) && valid(destination) ? { origin, destination, provisional: true } : undefined;
}

/** Read-only item-scoped conditions from the owner-authorized focused transport.
 * Recomputed from Trip on each load; never written into Request or Profile. */
export function savedTransportSearchConstraints(trip: Trip, itemId?: string): TripConstraint[] {
  const item = trip.items.find(value => value.id === itemId);
  if (!item || item.type !== "transport") return [];
  const endpoints = savedTransportEndpoints(item);
  if (!endpoints) return [];
  const key = stableContractHash({ itemId: item.id }).slice(0, 16);
  const condition = (target: string, requirement: TripConstraint["requirement"]): TripConstraint => ({
    id: `itinerary-search:${key}:${target}`, source: "legacy", strength: "soft", scope: { type: "item", itemId: item.id }, requirement,
  });
  const constraints = [
    condition("origin", { type: "origin", place: { name: endpoints.origin, sources: [] } }),
    condition("destination", { type: "destinations", places: [{ name: endpoints.destination, sources: [] }], order: "flexible" }),
  ];
  const schedule = item.schedule;
  const date = item.detail.status === "selected" && item.detail.mode === "rail" ? item.detail.journey.serviceDate
    : schedule.type === "day" ? schedule.date : schedule.type === "fixed" ? schedule.startAt.at.slice(0, 10)
      : schedule.type === "relative" && trip.timeline ? bindRelativeSchedule(schedule, trip.timeline)?.date : undefined;
  if (date) constraints.push(condition("start_date", { type: "dates", start: { earliest: date, latest: date } }));
  return constraints;
}
