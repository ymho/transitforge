import { exactKeys, validInstant } from "./snapshot-validation";
import { validateExternalSourceEvidence, type ExternalSourceEvidence, type ExternalInformationFreshness } from "./external-travel-information";
import { validateHazardAlert, hazardAlertCategories, type HazardAlert, type HazardAlertCategory } from "./hazard-alert";
import { monitoringKey, monitoringText, validateWatchSubject, watchSubjectKey, type WatchSubject } from "./trip-watch";

interface EventObservation {
  readonly observedAt: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly sources: readonly ExternalSourceEvidence[];
  readonly freshness: ExternalInformationFreshness;
}
export type UnknownEventFact = { readonly status: "unknown" | "unavailable"; readonly reason: "missing" | "failed" | "identity-unresolved" | "invalid" };
export type RailEventFact = UnknownEventFact | {
  readonly status: "observed";
  readonly delayMinutes?: number;
  readonly cancelled?: boolean;
  readonly destination?: string;
  readonly longTimeStopping?: boolean;
};
export type HazardEventFact = UnknownEventFact | {
  readonly status: "observed";
  /** Query-limited discovery, NOT proof that this area is safe or all warnings were returned. */
  readonly coverage: "query-limited";
  readonly queriedCategories: readonly HazardAlertCategory[];
  readonly alerts: readonly HazardAlert[];
};
export type WeatherEventFact = UnknownEventFact | {
  readonly status: "observed";
  readonly temperatureCelsius?: number;
  readonly precipitationMillimetres?: number;
};
export type TravelEvent = EventObservation & { readonly id: string } & (
  | { readonly kind: "rail-operation"; readonly subject: Extract<WatchSubject, { type: "rail-service" }>; readonly fact: RailEventFact }
  | { readonly kind: "hazard"; readonly subject: { readonly type: "hazard-area"; readonly area: string }; readonly fact: HazardEventFact }
  | { readonly kind: "weather"; readonly subject: { readonly type: "weather-area"; readonly area: string }; readonly fact: WeatherEventFact }
);

/** Stable state key: new retrieval/evidence IDs alone are not a new event. A -> B -> A reuses A.
 * #395 owns notification episodes/delivery dedupe; observations can refresh metadata for this identity.
 */
export function travelEventId(event: Omit<TravelEvent, "id">): string {
  return monitoringKey(["event-v1", event.kind, watchSubjectKey(event.subject), event.freshness, event.fact]);
}
export function validateTravelEvent(event: TravelEvent): void {
  exactKeys(event, ["id", "kind", "subject", "observedAt", "sourceEvidenceIds", "sources", "freshness", "fact"]);
  validateWatchSubject(event.subject);
  if (!validInstant(event.observedAt) || !["fresh", "stale", "unknown"].includes(event.freshness) ||
      !Array.isArray(event.sources) || event.sources.length > 24 || !Array.isArray(event.sourceEvidenceIds)) throw new Error("Invalid event observation");
  event.sources.forEach((source) => { validateExternalSourceEvidence(source); monitoringText(source.id, 500); });
  const ids = [...new Set(event.sources.map((s) => s.id))].sort();
  if (monitoringKey(ids) !== monitoringKey(event.sourceEvidenceIds)) throw new Error("Event evidence references differ");
  if (event.kind === "rail-operation" ? event.subject.type !== "rail-service" : event.kind === "hazard" ? event.subject.type !== "hazard-area" : event.kind !== "weather" || event.subject.type !== "weather-area") throw new Error("Event subject mismatch");
  const fact = event.fact;
  if (fact.status === "unknown" || fact.status === "unavailable") {
    exactKeys(fact, ["status", "reason"]);
    if (!["missing", "failed", "identity-unresolved", "invalid"].includes(fact.reason)) throw new Error("Invalid unknown fact");
  } else if (fact.status !== "observed") throw new Error("Invalid fact status");
  else {
    if (!event.sources.length) throw new Error("Observed fact requires evidence");
    if (event.kind === "rail-operation") {
      const rail = event.fact as Extract<RailEventFact, { status: "observed" }>;
      exactKeys(rail, ["status", "delayMinutes", "cancelled", "destination", "longTimeStopping"]);
      if (Object.keys(rail).length < 2) throw new Error("Rail facts missing");
      if (rail.delayMinutes !== undefined && (!Number.isFinite(rail.delayMinutes) || rail.delayMinutes < 0)) throw new Error("Invalid delay");
      if (rail.destination !== undefined) monitoringText(rail.destination);
      for (const flag of [rail.cancelled, rail.longTimeStopping]) if (flag !== undefined && typeof flag !== "boolean") throw new Error("Invalid operation flag");
    } else if (event.kind === "hazard") {
      const hazard = event.fact as Extract<HazardEventFact, { status: "observed" }>;
      exactKeys(hazard, ["status", "coverage", "queriedCategories", "alerts"]);
      if (hazard.coverage !== "query-limited" || !Array.isArray(hazard.alerts) || hazard.alerts.length > 12 ||
          !Array.isArray(hazard.queriedCategories) || new Set(hazard.queriedCategories).size !== hazard.queriedCategories.length ||
          !hazard.queriedCategories.every((c) => hazardAlertCategories.includes(c))) throw new Error("Invalid hazard scope");
      hazard.alerts.forEach(validateHazardAlert);
    } else {
      const weather = event.fact as Extract<WeatherEventFact, { status: "observed" }>;
      exactKeys(weather, ["status", "temperatureCelsius", "precipitationMillimetres"]);
      if (weather.temperatureCelsius === undefined && weather.precipitationMillimetres === undefined ||
          weather.temperatureCelsius !== undefined && !Number.isFinite(weather.temperatureCelsius) ||
          weather.precipitationMillimetres !== undefined && (!Number.isFinite(weather.precipitationMillimetres) || weather.precipitationMillimetres < 0)) throw new Error("Invalid weather fact");
    }
  }
  if (event.id !== travelEventId(event)) throw new Error("Event identity mismatch");
}
