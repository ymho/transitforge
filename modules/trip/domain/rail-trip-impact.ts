import { realtimeSnapshotToleranceMilliseconds } from "@raiquora/operation/train-operation-state";
import { isInOperatingDay } from "@raiquora/operation/operating-day";
import { validateTrip, type Trip } from "./trip";
import { validateTravelEvent, type TravelEvent } from "./travel-event";
import { validateTripWatch, projectTripWatches, watchSubjectKey, monitoringKey, type TripWatch } from "./trip-watch";
import { validateReservationFact, type ReservationFact } from "./reservation";
import { projectTripPlaces } from "./trip-places";
import { samePlaceIdentity } from "./place-snapshot";
import { validInstant } from "./snapshot-validation";
import { validateZonedInstant, type ZonedInstant } from "./itinerary-schedule";
import { tripImpactId, validateTripImpact, type TripImpact, type TripImpactReason, type TripImpactFact } from "./trip-impact";

export const railImpactPolicyVersion = "rail-service-delay-v1";
export interface RailTripImpactInput {
  trip: Trip; event: TravelEvent; watches: readonly TripWatch[];
  reservations: readonly ReservationFact[]; evaluatedAt: string;
}

/** Instant arithmetic with the original explicit zone, including a DST boundary. No host time zone. */
function shifted(value: ZonedInstant, minutes: number): ZonedInstant {
  const epoch = new Date(Date.parse(value.at) + minutes * 60_000).getTime();
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: value.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(epoch));
  const p = (name: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === name)!.value;
  const local = `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}`;
  const offset = (Date.parse(`${local}Z`) - Math.floor(epoch / 1000) * 1000) / 60_000;
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0"), mm = String(Math.abs(offset) % 60).padStart(2, "0");
  const result = { at: `${local}.${String(((epoch % 1000) + 1000) % 1000).padStart(3, "0")}${offset < 0 ? "-" : "+"}${hh}:${mm}`, timeZone: value.timeZone };
  validateZonedInstant(result); return result;
}
const minutesBetween = (a: ZonedInstant, b: ZonedInstant) => (Date.parse(b.at) - Date.parse(a.at)) / 60_000;

/** Pure lower-bound risk analysis. Never updates scheduled facts, bookings, planned feasibility or notification state. */
export function evaluateRailTripImpact(input: RailTripImpactInput): TripImpact {
  const { trip, event, watches, reservations, evaluatedAt } = input;
  validateTrip(trip); validateTravelEvent(event); watches.forEach(validateTripWatch); reservations.forEach(validateReservationFact);
  if (!validInstant(evaluatedAt) || event.kind !== "rail-operation" || !watches.length) throw new Error("Rail impact input required");
  const affected = new Set<string>(), reasons = new Set<TripImpactReason>(), facts: TripImpactFact[] = [];
  let unknown = false, attention = false, action = false;
  const uncertain = (itemId: string, reason: Extract<TripImpactFact, { type: "uncertainty" }>["reason"]) => {
    unknown = true; affected.add(itemId); reasons.add("external_data_unknown"); facts.push({ type: "uncertainty", itemId, reason });
  };
  const now = Date.parse(evaluatedAt), observed = Date.parse(event.observedAt);
  const fresh = event.freshness === "fresh" && event.fact.status === "observed" && observed <= now &&
    now - observed <= realtimeSnapshotToleranceMilliseconds && isInOperatingDay(event.observedAt, event.subject.serviceDate) &&
    event.sources.length > 0 && event.sources.every((s) => s.kind === "event" && s.confidence === "observed" &&
      Date.parse(s.retrievedAt) <= now && Date.parse(s.retrievedAt) >= observed &&
      (s.observedAt === undefined || Date.parse(s.observedAt) === observed) &&
      (s.validFrom === undefined || Date.parse(s.validFrom) <= now) && (s.validUntil === undefined || Date.parse(s.validUntil) >= now));
  const places = projectTripPlaces(trip).visitedPlaces;
  const expectedWatches = projectTripWatches(trip);
  for (const item of trip.items.filter((i) => watches.some((w) => w.itineraryItemId === i.id))) {
    affected.add(item.id);
    if (item.type !== "transport" || item.detail.mode !== "rail" || item.detail.status !== "selected" ||
        watches.filter((w) => w.itineraryItemId === item.id).some((w) => w.tripId !== trip.id || w.sourceTripRevision !== trip.revision ||
          watchSubjectKey(w.subject) !== watchSubjectKey(event.subject) || !expectedWatches.some((expected) => monitoringKey(expected) === monitoringKey(w)))) { uncertain(item.id, "service_binding"); continue; }
    const journey = item.detail.journey;
    if (reservations.some((r) => r.itineraryItemId === item.id &&
        (r.status === "unknown" || r.status === "booked" && !r.startsAt))) uncertain(item.id, "reservation_time");
    // UID is required here. Number-only upstream observations must first pass railTravelEvent's unique dated binding.
    const matching = journey.legs.filter((leg) => event.subject.serviceUid !== undefined && leg.serviceDate === event.subject.serviceDate &&
      leg.serviceUid === event.subject.serviceUid && (event.subject.trainNumber === undefined || leg.trainNumber === event.subject.trainNumber));
    if (!matching.length) { uncertain(item.id, "service_binding"); continue; }
    if (!fresh || event.fact.status !== "observed") { uncertain(item.id, "external_data"); continue; }
    const operation = event.fact;
    for (const leg of matching) {
      if (operation.cancelled === true) { action = true; reasons.add("rail_cancelled"); facts.push({ type: "rail-observation", itemId: item.id, legId: leg.id, observation: "cancelled" }); }
      if (operation.destination !== undefined) {
        // The source supplies only a name, not a dated stop identity/termination index. Even a familiar station name is not proof.
        uncertain(item.id, "destination_identity"); reasons.add("destination_unverified");
        facts.push({ type: "rail-observation", itemId: item.id, legId: leg.id, observation: "destination-unresolved" });
      }
      if (operation.longTimeStopping === true) { reasons.add("long_stop"); facts.push({ type: "rail-observation", itemId: item.id, legId: leg.id, observation: "long-stop" }); }
      if (operation.delayMinutes === undefined) { uncertain(item.id, "delay_missing"); continue; }
      const delay = operation.delayMinutes;
      if (delay > 0) reasons.add("rail_delay");
      facts.push({ type: "rail-delay", itemId: item.id, legId: leg.id, delayMinutes: delay,
        projectedDepartureAt: shifted(leg.scheduledDeparture, delay), projectedArrivalAt: shifted(leg.scheduledArrival, delay) });
      for (const transfer of journey.transfers.filter((t) => t.fromLegId === leg.id)) {
        const next = journey.legs.find((l) => l.id === transfer.toLegId)!;
        const nextObserved = matching.some((l) => l.id === next.id);
        const scheduled = minutesBetween(leg.scheduledArrival, next.scheduledDeparture);
        const projected = scheduled - delay + (nextObserved ? delay : 0);
        facts.push({ type: "connection-buffer", itemId: item.id, fromLegId: leg.id, toLegId: next.id,
          requiredMinutes: transfer.minimumTransferMinutes, scheduledMinutes: scheduled, projectedMinutes: projected,
          departureBasis: nextObserved ? "observed-service-delay" : "scheduled" });
        if (projected < transfer.minimumTransferMinutes) { action = true; reasons.add("connection_risk"); }
        else if (scheduled > transfer.minimumTransferMinutes && projected < scheduled &&
            projected - transfer.minimumTransferMinutes <= (scheduled - transfer.minimumTransferMinutes) / 2) attention = true;
      }
    }
    const last = journey.legs.at(-1)!;
    const lastObserved = matching.some((l) => l.id === last.id) && operation.delayMinutes !== undefined;
    const following = trip.items.slice(trip.items.indexOf(item) + 1);
    if (!lastObserved) {
      // Cannot propagate delay through an unobserved connection as if a missed train had been caught.
      if (following.length || reservations.length) uncertain(item.id, "onward_arrival");
      continue;
    }
    const arrival = shifted(last.scheduledArrival, operation.delayMinutes!);
    for (const [index, next] of following.entries()) {
      const schedule = next.schedule;
      const target = schedule.type === "fixed" ? schedule.startAt : schedule.type === "window"
        ? shifted(schedule.latestEnd, -(schedule.durationMinutes ?? 0)) : undefined;
      if (target && Date.parse(arrival.at) > Date.parse(target.at)) {
        action = true; reasons.add("appointment_risk"); affected.add(next.id);
        facts.push({ type: "schedule-risk", fromItemId: item.id, toItemId: next.id, projectedArrivalAt: arrival,
          targetStartAt: target, targetBasis: schedule.type === "fixed" ? "fixed" : "window-latest-start" });
      } else if (schedule.type === "window") uncertain(next.id, "window_placement");
      else if (schedule.type !== "fixed") uncertain(next.id, "schedule_precision");
      else {
        const place = places.find((p) => p.itemId === next.id)?.place;
        if (index !== 0 || !samePlaceIdentity(last.destination.ref, place?.ref)) uncertain(next.id, "movement_missing");
      }
    }
    for (const reservation of [...reservations].sort((a, b) => a.reservationId.localeCompare(b.reservationId))) {
      if (!reservation.itineraryItemId) { if (reservation.status === "booked" || reservation.status === "unknown") uncertain(item.id, "reservation_time"); continue; }
      const next = following.find((i) => i.id === reservation.itineraryItemId);
      if (!next) continue;
      if (reservation.status === "unknown" || reservation.status === "booked" && !reservation.startsAt) uncertain(next.id, "reservation_time");
      if (reservation.status === "booked" && reservation.startsAt && Date.parse(arrival.at) > Date.parse(reservation.startsAt.at)) {
        action = true; affected.add(next.id); reasons.add("appointment_risk");
        facts.push({ type: "reservation-risk", itemId: next.id, reservationId: reservation.reservationId,
          projectedArrivalAt: arrival, bookedStartAt: reservation.startsAt });
      }
    }
  }
  if (!affected.size || watches.some((w) => !trip.items.some((i) => i.id === w.itineraryItemId))) throw new Error("Watch item missing");
  if (!reasons.size) reasons.add("no_material_change");
  // Canonical order and duplicate removal make repeated/permuted Watch input deterministic.
  const uniqueFacts = [...new Map(facts.map((fact) => [monitoringKey(fact), fact])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, fact]) => fact);
  const result: Omit<TripImpact, "id"> = { tripId: trip.id, tripRevision: trip.revision, eventId: event.id,
    policyVersion: railImpactPolicyVersion, status: action || attention ? "impact" : unknown ? "unknown" : "no-impact",
    severity: action ? "action-required" : attention ? "attention" : "informational", affectedItemIds: [...affected].sort(),
    reasonCodes: [...reasons].sort(), facts: uniqueFacts, evaluatedAt };
  const impact = { ...result, id: tripImpactId(result) }; validateTripImpact(impact); return impact;
}
