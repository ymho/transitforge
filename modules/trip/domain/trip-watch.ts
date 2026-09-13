import { validateTrip, type Trip } from "./trip";
import { validateItinerarySchedule, type ItinerarySchedule, type LocalDate } from "./itinerary-schedule";
import { exactKeys, validDate } from "./snapshot-validation";

export type WatchSubject =
  | { readonly type: "rail-service"; readonly serviceDate: LocalDate; readonly serviceUid?: string; readonly trainNumber?: string }
  | { readonly type: "hazard-area" | "weather-area"; readonly area: string };
export interface TripWatch {
  readonly id: string;
  readonly tripId: string;
  readonly itineraryItemId: string;
  readonly sourceTripRevision: number;
  readonly subject: WatchSubject;
  /** Same precision vocabulary as the plan; day is not a midnight appointment. No buffers in v1. */
  readonly activeWindow: ItinerarySchedule;
}
/** Resolved by a trusted Application scope resolver, never inferred from a place/title by this projector. */
export interface ResolvedWatchScope {
  readonly itineraryItemId: string;
  readonly subject: Extract<WatchSubject, { area: string }>;
}
export interface StoredTripWatch { readonly watch: TripWatch; readonly active: boolean }

export function monitoringText(value: unknown, maximum = 200): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Invalid monitoring identifier");
}
export function monitoringRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid monitoring revision");
}
/** Stable, collision-free JSON key, not a hash, title or provider-normalized identifier. */
export function monitoringKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(monitoringKey).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${monitoringKey(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function validateWatchSubject(subject: WatchSubject): void {
  if (subject.type === "rail-service") {
    exactKeys(subject, ["type", "serviceDate", "serviceUid", "trainNumber"]);
    if (!validDate(subject.serviceDate) || subject.serviceUid === undefined && subject.trainNumber === undefined) throw new Error("Dated service identity required");
    if (subject.serviceUid !== undefined) monitoringText(subject.serviceUid);
    if (subject.trainNumber !== undefined) monitoringText(subject.trainNumber);
  } else {
    exactKeys(subject, ["type", "area"]);
    if (subject.type !== "hazard-area" && subject.type !== "weather-area") throw new Error("Unknown watch subject");
    monitoringText(subject.area, 80);
  }
}
export function watchSubjectKey(subject: WatchSubject): string {
  validateWatchSubject(subject);
  return monitoringKey(subject.type === "rail-service"
    ? [subject.type, subject.serviceDate, subject.serviceUid === undefined ? "number" : "uid", subject.serviceUid ?? subject.trainNumber]
    : [subject.type, subject.area]);
}
export function tripWatchId(tripId: string, itemId: string, subject: WatchSubject): string {
  monitoringText(tripId); monitoringText(itemId);
  return monitoringKey(["watch-v1", tripId, itemId, watchSubjectKey(subject)]);
}
export function validateTripWatch(watch: TripWatch): void {
  exactKeys(watch, ["id", "tripId", "itineraryItemId", "sourceTripRevision", "subject", "activeWindow"]);
  monitoringRevision(watch.sourceTripRevision); validateItinerarySchedule(watch.activeWindow);
  if (watch.id !== tripWatchId(watch.tripId, watch.itineraryItemId, watch.subject)) throw new Error("Invalid watch identity");
}

export function projectTripWatches(trip: Trip, scopes: readonly ResolvedWatchScope[] = []): TripWatch[] {
  validateTrip(trip);
  for (const scope of scopes) {
    exactKeys(scope, ["itineraryItemId", "subject"]); validateWatchSubject(scope.subject);
    if (!["hazard-area", "weather-area"].includes(scope.subject.type) || !trip.items.some((item) => item.id === scope.itineraryItemId)) throw new Error("Invalid resolved scope");
  }
  if (trip.lifecycleState === "cancelled" || trip.lifecycleState === "completed") return [];
  const watches = new Map<string, TripWatch>();
  const add = (itemId: string, subject: WatchSubject, activeWindow: ItinerarySchedule) => {
    const watch: TripWatch = { id: tripWatchId(trip.id, itemId, subject), tripId: trip.id, itineraryItemId: itemId,
      sourceTripRevision: trip.revision, subject, activeWindow };
    validateTripWatch(watch);
    const prior = watches.get(watch.id);
    // A service revisited within one item uses the encompassing scheduled watch interval, not duplicate identity.
    if (prior?.activeWindow.type === "fixed" && activeWindow.type === "fixed" && prior.activeWindow.endAt && activeWindow.endAt) {
      watches.set(watch.id, { ...watch, activeWindow: { type: "fixed",
        startAt: Date.parse(prior.activeWindow.startAt.at) <= Date.parse(activeWindow.startAt.at) ? prior.activeWindow.startAt : activeWindow.startAt,
        endAt: Date.parse(prior.activeWindow.endAt.at) >= Date.parse(activeWindow.endAt.at) ? prior.activeWindow.endAt : activeWindow.endAt } });
    } else watches.set(watch.id, watch);
  };
  for (const item of trip.items) {
    if (item.type === "transport" && item.detail.mode === "rail" && item.detail.status === "selected") {
      for (const leg of item.detail.journey.legs) add(item.id,
        { type: "rail-service", serviceDate: leg.serviceDate, serviceUid: leg.serviceUid, trainNumber: leg.trainNumber },
        { type: "fixed", startAt: leg.scheduledDeparture, endAt: leg.scheduledArrival });
    }
    for (const scope of scopes.filter((s) => s.itineraryItemId === item.id)) add(item.id, scope.subject, item.schedule);
  }
  return structuredClone([...watches.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Pure difference; inactive history is retained and identity never changes in place. */
export function diffTripWatches(tripId: string, revision: number, existing: readonly StoredTripWatch[], desired: readonly TripWatch[]) {
  monitoringRevision(revision);
  const old = new Map<string, StoredTripWatch>(), next = new Map<string, TripWatch>();
  for (const record of existing) {
    exactKeys(record, ["watch", "active"]); validateTripWatch(record.watch);
    if (typeof record.active !== "boolean" || record.watch.tripId !== tripId || old.has(record.watch.id) || record.watch.sourceTripRevision > revision) throw new Error("Stale/invalid watch collection");
    old.set(record.watch.id, record);
  }
  for (const watch of desired) {
    validateTripWatch(watch);
    if (watch.tripId !== tripId || watch.sourceTripRevision !== revision || next.has(watch.id)) throw new Error("Invalid desired watches");
    next.set(watch.id, watch);
  }
  const unchanged: StoredTripWatch[] = [], writes: StoredTripWatch[] = [];
  for (const watch of next.values()) {
    const prior = old.get(watch.id), record = { watch, active: true };
    (prior && monitoringKey(prior) === monitoringKey(record) ? unchanged : writes).push(record);
  }
  for (const record of old.values()) if (!next.has(record.watch.id)) {
    (record.active ? writes : unchanged).push({ watch: record.watch, active: false });
  }
  return structuredClone({ unchanged, writes });
}
