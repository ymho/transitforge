import { validateTrip, type Trip, type ItineraryItem } from "./trip";
import { positionAt } from "./trip-temporal";
import { validateZonedInstant, validateItinerarySchedule, type ZonedInstant, type ItinerarySchedule } from "./itinerary-schedule";
import { validateTripImpact, tripImpactReasons, type TripImpact, type TripImpactFact } from "./trip-impact";
import { validateReservationFact, type ReservationFact } from "./reservation";
import { validateNotificationView, type NotificationView } from "./notification";
import { exactKeys, validInstant } from "./snapshot-validation";
import { validateTripImpactFact } from "./trip-impact-fact";

export type ContextLocation = { status: "not-requested" | "permission-denied" | "unavailable" }
  | { status: "available"; consent: "explicit"; observedAt: string; longitude: number; latitude: number; accuracyMeters: number };
export interface ContextItem {
  itemId: string; type: ItineraryItem["type"]; title: string; schedule: ItinerarySchedule;
  position: "past" | "current" | "possible-current" | "date-current" | "upcoming" | "unknown";
  placeName?: string; origin?: string; destination?: string;
  rail?: { trainNumber: string; origin: string; destination: string; departure: ZonedInstant; arrival: ZonedInstant }[];
  railTruncated?: boolean;
}
export interface ContextImpact {
  status: TripImpact["status"]; severity: TripImpact["severity"]; affectedItemIds: string[];
  reasonCodes: TripImpact["reasonCodes"]; evaluatedAt: string; observedAt: string; expiresAt: string;
  facts: Record<string, unknown>[]; truncated: boolean;
}
export interface ContextPage<T> { status: "available" | "unknown" | "unavailable"; items: T[]; truncated: boolean; omitted: number; }
export interface InTripContextSnapshot {
  version: "in-trip-v1";
  trip: { id: string; revision: number; lifecycleState: "in_trip"; title: string; currency: "current" | "unconfirmed" };
  now: ZonedInstant;
  itinerary: { previous: ContextItem[]; current: ContextItem[]; next: ContextItem[]; upcoming: ContextItem[]; uncertain: ContextItem[]; omitted: number };
  impacts: ContextPage<ContextImpact>;
  notifications: ContextPage<Pick<NotificationView, "severity" | "status" | "phase" | "createdAt" | "message" | "currency" | "itemIds">>;
  reservations: ContextPage<Pick<ReservationFact, "kind" | "status" | "itineraryItemId" | "startsAt" | "endsAt">>;
  /** Environment measurements are already bound/evaluated in impacts; no separate raw collector payload. */
  environment: { source: "trip-impact"; status: "available" | "unknown" | "unavailable" };
  location: ContextLocation;
  truncation: { truncated: boolean; maximumCharacters: 18000 };
}
export interface InTripFacts {
  /** Set only after an owner-scoped current Trip re-read by the application. */
  tripConfirmed?: boolean;
  impacts?: { impact: TripImpact; observedAt: string; expiresAt: string; fresh: boolean }[];
  notifications?: NotificationView[];
  reservations?: readonly ReservationFact[];
  impactTruncated?: boolean;
  notificationTruncated?: boolean;
  unavailable?: readonly ("impacts" | "notifications" | "reservations")[];
}
const text = (v: string) => v.slice(0, 120);
const page = <T>(items: T[] | undefined, limit: number, unavailable: boolean, truncated = false): ContextPage<T> => ({
  status: unavailable ? "unavailable" : items === undefined ? "unknown" : "available", items: unavailable ? [] : (items ?? []).slice(0, limit),
  truncated: truncated || (items?.length ?? 0) > limit, omitted: Math.max(0, (items?.length ?? 0) - limit),
});
export function contextLocation(location: ContextLocation | undefined, now: ZonedInstant): ContextLocation {
  if (!location) return { status: "not-requested" };
  if (location.status !== "available") {
    if (!["not-requested", "permission-denied", "unavailable"].includes(location.status)) throw new Error("Invalid location state");
    return { status: location.status };
  }
  if (location.consent !== "explicit" || !validInstant(location.observedAt) ||
      !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180 ||
      !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
      !Number.isFinite(location.accuracyMeters) || location.accuracyMeters < 0 ||
      Date.parse(location.observedAt) > Date.parse(now.at) || Date.parse(now.at) - Date.parse(location.observedAt) > 300000) return { status: "unavailable" };
  return { status: "available", consent: "explicit", observedAt: location.observedAt, longitude: location.longitude,
    latitude: location.latitude, accuracyMeters: location.accuracyMeters };
}
export function inTripItem(item: ItineraryItem, now: ZonedInstant): ContextItem {
  const position = positionAt(item.schedule, new Date(now.at));
  const result: ContextItem = { itemId: item.id, type: item.type, title: text(item.title), schedule: structuredClone(item.schedule),
    position: position === "current" ? item.schedule.type === "window" ? "possible-current" : item.schedule.type === "day" ? "date-current" : "current" : position };
  if (item.type === "activity" && item.place) result.placeName = text(item.place.name);
  if (item.type === "stay") {
    const place = item.selection.status === "selected" ? item.selection.accommodation.place : item.selection.place;
    if (place) result.placeName = text(place.name);
  }
  if (item.type === "transport" && item.detail.status === "selected") {
    if (item.detail.mode === "rail") {
      result.rail = item.detail.journey.legs.slice(0, 4).map((leg) => ({ trainNumber: text(leg.trainNumber), origin: text(leg.origin.name),
        destination: text(leg.destination.name), departure: structuredClone(leg.scheduledDeparture), arrival: structuredClone(leg.scheduledArrival) }));
      result.railTruncated = item.detail.journey.legs.length > 4;
    } else { result.origin = text(item.detail.origin.name); result.destination = text(item.detail.destination.name); }
  }
  return result;
}

/** Strict read DTO validation at HTTP/model boundaries, not a public assertion of provenance. */
export function validateInTripContext(v: InTripContextSnapshot): void {
  const assert = (ok: boolean) => { if (!ok) throw new Error("Invalid in-trip read model"); };
  const str = (x: unknown, max = 1000) => typeof x === "string" && x.length > 0 && x.length <= max;
  const int = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
  const arr = (x: unknown, max: number): unknown[] => { assert(Array.isArray(x) && x.length <= max); return x as unknown[]; };
  exactKeys(v, ["version", "trip", "now", "itinerary", "impacts", "notifications", "reservations", "environment", "location", "truncation"]);
  assert(v.version === "in-trip-v1" && JSON.stringify(v).length <= 18000);
  exactKeys(v.trip, ["id", "revision", "lifecycleState", "title", "currency"]);
  assert(/^[a-f0-9-]{36}$/i.test(v.trip.id) && int(v.trip.revision) && v.trip.lifecycleState === "in_trip" && str(v.trip.title, 120));
  assert(["current", "unconfirmed"].includes(v.trip.currency));
  validateZonedInstant(v.now);
  exactKeys(v.itinerary, ["previous", "current", "next", "upcoming", "uncertain", "omitted"]);
  assert(int(v.itinerary.omitted));
  for (const [k, max] of [["previous", 1], ["current", 2], ["next", 2], ["upcoming", 4], ["uncertain", 2]] as const) {
    arr(v.itinerary[k], max);
    for (const i of v.itinerary[k]) {
      exactKeys(i, ["itemId", "type", "title", "schedule", "position", "placeName", "origin", "destination", "rail", "railTruncated"]);
      assert(str(i.itemId) && str(i.title, 120) && ["transport", "stay", "activity"].includes(i.type) &&
        ["past", "current", "possible-current", "date-current", "upcoming", "unknown"].includes(i.position));
      validateItinerarySchedule(i.schedule);
      const position = positionAt(i.schedule, new Date(v.now.at));
      const expected = position === "current" ? i.schedule.type === "window" ? "possible-current" : i.schedule.type === "day" ? "date-current" : "current" : position;
      assert(i.position === expected && (k === "previous" ? expected === "past" : k === "uncertain" ? expected === "unknown"
        : k === "next" || k === "upcoming" ? expected === "upcoming" : ["current", "possible-current", "date-current"].includes(expected)));
      for (const s of [i.placeName, i.origin, i.destination]) assert(s === undefined || str(s, 120));
      if (i.rail !== undefined) { arr(i.rail, 4); assert(typeof i.railTruncated === "boolean"); for (const leg of i.rail) {
        exactKeys(leg, ["trainNumber", "origin", "destination", "departure", "arrival"]);
        assert([leg.trainNumber, leg.origin, leg.destination].every((s) => str(s, 120))); validateZonedInstant(leg.departure); validateZonedInstant(leg.arrival);
      } }
    }
  }
  for (const [p, limit] of [[v.impacts, 6], [v.notifications, 4], [v.reservations, 8]] as const) {
    exactKeys(p, ["status", "items", "truncated", "omitted"]);
    assert(["available", "unknown", "unavailable"].includes(p.status) && int(p.omitted) && typeof p.truncated === "boolean"); arr(p.items, limit);
  }
  for (const i of v.impacts.items) {
    exactKeys(i, ["status", "severity", "affectedItemIds", "reasonCodes", "evaluatedAt", "observedAt", "expiresAt", "facts", "truncated"]);
    assert(["unknown", "impact", "no-impact"].includes(i.status) && ["informational", "attention", "action-required", "critical"].includes(i.severity) && typeof i.truncated === "boolean");
    assert(arr(i.affectedItemIds, 12).every((s) => str(s)) && arr(i.reasonCodes, 20).every((s) => tripImpactReasons.includes(s as typeof tripImpactReasons[number])));
    assert(i.status === "impact" || i.severity === "informational");
    assert([i.evaluatedAt, i.observedAt, i.expiresAt].every(validInstant)); arr(i.facts, 4);
    assert(Date.parse(i.observedAt) <= Date.parse(i.evaluatedAt) && Date.parse(i.evaluatedAt) <= Date.parse(v.now.at) && Date.parse(v.now.at) < Date.parse(i.expiresAt));
    for (const f of i.facts) {
      assert(!("reservationId" in f) && !("providerAlertId" in f));
      validateTripImpactFact({ ...f, ...(f.type === "reservation-risk" ? { reservationId: "11111111-1111-4111-8111-111111111111" } : {}),
        ...(f.type === "hazard-exposure" ? { providerAlertId: "redacted" } : {}) } as TripImpactFact);
    }
  }
  for (const n of v.notifications.items) {
    exactKeys(n, ["severity", "status", "phase", "createdAt", "message", "currency", "itemIds"]);
    validateNotificationView({ ...n, id: "a".repeat(64), version: 0, tripId: v.trip.id, tripRevision: v.trip.revision });
    assert(n.message.length <= 500 && n.itemIds.length <= 12);
  }
  for (const r of v.reservations.items) {
    exactKeys(r, ["kind", "status", "itineraryItemId", "startsAt", "endsAt"]);
    validateReservationFact({ ...r, reservationId: "11111111-1111-4111-8111-111111111111", revision: 0 });
  }
  exactKeys(v.environment, ["source", "status"]); assert(v.environment.source === "trip-impact" && ["available", "unknown", "unavailable"].includes(v.environment.status));
  exactKeys(v.location, v.location.status === "available" ? ["status", "consent", "observedAt", "longitude", "latitude", "accuracyMeters"] : ["status"]);
  assert(contextLocation(v.location, v.now).status === v.location.status);
  exactKeys(v.truncation, ["truncated", "maximumCharacters"]); assert(typeof v.truncation.truncated === "boolean" && v.truncation.maximumCharacters === 18000);
}
/** Facts have already been strictly validated. Strip internal/private identity, never regenerate measurements. */
function factProjection(fact: TripImpactFact): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fact).filter(([k]) => !["reservationId", "providerAlertId"].includes(k))
    .map(([k, v]) => [k, typeof v === "string" && k === "area" ? text(v) : structuredClone(v)]));
}
/** Read-only, explicit clock, adopted order within each precision group; never an execution/location claim. */
export function buildInTripContext(trip: Trip, now: ZonedInstant, facts: InTripFacts = {}, location?: ContextLocation): InTripContextSnapshot | undefined {
  validateTrip(trip); validateZonedInstant(now);
  if (trip.lifecycleState !== "in_trip") return undefined;
  const all = trip.items.map((i) => inTripItem(i, now));
  const past = all.filter((i) => i.position === "past"), future = all.filter((i) => i.position === "upcoming");
  const itinerary = { previous: past.slice(-1), current: all.filter((i) => ["current", "possible-current", "date-current"].includes(i.position)).slice(0, 2),
    next: future.slice(0, 2), upcoming: future.slice(2, 6), uncertain: all.filter((i) => i.position === "unknown").slice(0, 2), omitted: 0 };
  itinerary.omitted = all.length - [itinerary.previous, itinerary.current, itinerary.next, itinerary.upcoming, itinerary.uncertain].flat().length;
  const ids = new Set(trip.items.map((i) => i.id));
  let excluded = 0;
  const impacts = facts.impacts?.flatMap(({ impact: i, observedAt, expiresAt, fresh }) => {
    validateTripImpact(i);
    if (i.tripId !== trip.id || i.tripRevision !== trip.revision || !i.affectedItemIds.every((id) => ids.has(id)) || !fresh ||
        !validInstant(observedAt) || !validInstant(expiresAt) || Date.parse(observedAt) > Date.parse(now.at) ||
        Date.parse(i.evaluatedAt) > Date.parse(now.at) || Date.parse(expiresAt) <= Date.parse(now.at)) { excluded++; return []; }
    return [{ status: i.status, severity: i.severity, affectedItemIds: [...i.affectedItemIds].slice(0, 12), reasonCodes: [...i.reasonCodes],
      evaluatedAt: i.evaluatedAt, observedAt, expiresAt, facts: i.facts.slice(0, 4).map(factProjection), truncated: i.facts.length > 4 || i.affectedItemIds.length > 12 }];
  });
  // Preserve impactful and unknown results before no-impact. No new severity calculation.
  impacts?.sort((a, b) => Number(a.status === "no-impact") - Number(b.status === "no-impact"));
  const notifications = facts.notifications?.flatMap((n) => {
    validateNotificationView(n);
    if (n.tripId !== trip.id) return [];
    return [{ severity: n.severity, status: n.status, phase: n.phase, createdAt: n.createdAt, message: n.message.slice(0, 500),
      currency: n.tripRevision === trip.revision && n.itemIds.every((id) => ids.has(id)) ? n.currency : "historical" as const, itemIds: n.itemIds.slice(0, 12) }];
  });
  const reservations = facts.reservations?.flatMap((r) => {
    validateReservationFact(r);
    if (r.itineraryItemId && !ids.has(r.itineraryItemId)) return [];
    return [{ kind: r.kind, status: r.status, ...(r.itineraryItemId ? { itineraryItemId: r.itineraryItemId } : {}),
      ...(r.startsAt ? { startsAt: structuredClone(r.startsAt) } : {}), ...(r.endsAt ? { endsAt: structuredClone(r.endsAt) } : {}) }];
  });
  const result: InTripContextSnapshot = { version: "in-trip-v1", trip: { id: trip.id, revision: trip.revision, lifecycleState: "in_trip", title: text(trip.title), currency: facts.tripConfirmed ? "current" : "unconfirmed" }, now: structuredClone(now), itinerary,
    impacts: page(impacts, 6, facts.unavailable?.includes("impacts") ?? false, facts.impactTruncated),
    notifications: page(notifications, 4, facts.unavailable?.includes("notifications") ?? false, facts.notificationTruncated),
    reservations: page(reservations, 8, facts.unavailable?.includes("reservations") ?? false),
    environment: { source: "trip-impact", status: "unknown" }, location: contextLocation(location, now), truncation: { truncated: false, maximumCharacters: 18000 } };
  result.impacts.omitted += excluded;
  if (excluded && result.impacts.status === "available") result.impacts.status = "unknown";
  // Empty observations do not establish safety/weather/operation coverage.
  if (!result.impacts.items.length && result.impacts.status === "available") result.impacts.status = "unknown";
  result.environment.status = result.impacts.status === "unavailable" ? "unavailable"
    : result.impacts.items.some((i) => i.facts.some((f) => ["weather-exposure", "weather-placement", "hazard-exposure"].includes(String(f.type)))) ? result.impacts.status : "unknown";
  while (JSON.stringify(result).length > 17500 && result.impacts.items.length) { result.impacts.items.pop(); result.impacts.omitted++; result.impacts.truncated = true; }
  result.truncation.truncated = itinerary.omitted > 0 || [result.impacts, result.notifications, result.reservations].some((p) => p.truncated) ||
    result.impacts.items.some((i) => i.truncated) || all.some((i) => i.railTruncated);
  if (JSON.stringify(result).length > 18000) throw new Error("In-trip context budget exceeded");
  return result;
}
