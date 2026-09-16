import { validateTrip, type Trip } from "./trip";
import { validateTravelEvent, type TravelEvent } from "./travel-event";
import { monitoringKey, projectTripWatches, validateTripWatch, watchSubjectKey, type TripWatch } from "./trip-watch";
import { tripImpactId, validateTripImpact, type TripImpact, type TripImpactFact, type TripImpactReason } from "./trip-impact";
import { externalInformationFreshness, validateExternalSourceEvidence, type ExternalSourceEvidence } from "./external-travel-information";
import { exactKeys, validInstant } from "./snapshot-validation";
import { areaScheduleOverlap, forecastCoversSchedule, windowPrecipitationRelation } from "./area-impact-schedule";
import { instantInZone } from "./weather-event-fact";

export const areaImpactPolicyVersion = "weather-hazard-exposure-v1";
/** Optional verified provider fact, not a title/category heuristic or a new Activity taxonomy. */
export interface VerifiedWeatherSensitivity {
  readonly itemId: string; readonly area: string; readonly kind: "precipitation-sensitive";
  readonly verifiedAt: string; readonly sources: readonly ExternalSourceEvidence[];
}
export interface AreaTripImpactInput {
  readonly trip: Trip; readonly event: TravelEvent; readonly watches: readonly TripWatch[]; readonly evaluatedAt: string;
  readonly weatherSensitivity?: readonly VerifiedWeatherSensitivity[];
}
/** Pure exposure evaluation. No reservation, plan, checklist, notification, or feasibility writer. */
export function evaluateAreaTripImpact(input: AreaTripImpactInput): TripImpact {
  const { trip, event, watches, evaluatedAt } = input;
  validateTrip(trip); validateTravelEvent(event); watches.forEach(validateTripWatch);
  if (event.kind === "rail-operation" || !validInstant(evaluatedAt) || !watches.length) throw new Error("Area impact input required");
  const now = Date.parse(evaluatedAt), observed = Date.parse(event.observedAt);
  const expected = projectTripWatches(trip, watches.map((w) => {
    if (w.subject.type === "rail-service") throw new Error("Area watch required");
    return { itineraryItemId: w.itineraryItemId, subject: w.subject };
  }));
  if (watches.some((w) => watchSubjectKey(w.subject) !== watchSubjectKey(event.subject) ||
      !expected.some((e) => monitoringKey(e) === monitoringKey(w)))) throw new Error("Area Watch/Trip binding mismatch");
  const sensitivity = input.weatherSensitivity ?? [];
  if (sensitivity.length > 200) throw new Error("Sensitivity bound exceeded");
  sensitivity.forEach((s) => {
    exactKeys(s, ["itemId", "area", "kind", "verifiedAt", "sources"]);
    if (!trip.items.some((i) => i.id === s.itemId) || s.area !== event.subject.area || s.kind !== "precipitation-sensitive" ||
        !validInstant(s.verifiedAt) || Date.parse(s.verifiedAt) > now || !Array.isArray(s.sources) || !s.sources.length || s.sources.length > 24) throw new Error("Invalid sensitivity");
    s.sources.forEach((source) => { validateExternalSourceEvidence(source);
      if (source.confidence !== "observed" || Date.parse(source.retrievedAt) > Date.parse(s.verifiedAt)) throw new Error("Unverified sensitivity"); });
  });
  const fresh = event.freshness === "fresh" && event.fact.status === "observed" && observed <= now && now - observed <= 3600000 &&
    externalInformationFreshness([...event.sources], new Date(now)) === "fresh" && event.sources.length > 0 &&
    event.sources.every((s) => s.kind === (event.kind === "weather" ? "weather" : "safety-alert") &&
      (event.kind === "weather" ? s.confidence === "provider-forecast" : s.confidence === "observed") &&
      Date.parse(s.retrievedAt) <= observed && now - Date.parse(s.retrievedAt) <= 3600000 &&
      (s.observedAt === undefined || Date.parse(s.observedAt) <= observed));
  const facts: TripImpactFact[] = [], affected = [...new Set(watches.map((w) => w.itineraryItemId))].sort();
  const reasons = new Set<TripImpactReason>(); let attention = false;
  const uncertain = (itemId: string, reason: Extract<TripImpactFact, { type: "uncertainty" }>["reason"]) => {
    facts.push({ type: "uncertainty", itemId, reason }); reasons.add("external_data_unknown");
  };
  for (const itemId of affected) {
    const item = trip.items.find((i) => i.id === itemId)!;
    if (!fresh || event.fact.status !== "observed") { uncertain(itemId, "external_data"); continue; }
    if (event.kind === "weather" && event.fact.status === "observed") {
      const hours = event.fact.forecast;
      const covered = forecastCoversSchedule(item.schedule, hours.map((h) => Date.parse(h.at) - 3600000));
      const sensitive = sensitivity.some((s) => s.itemId === itemId && externalInformationFreshness([...s.sources], new Date(now)) === "fresh");
      if (!covered) uncertain(itemId, "forecast_coverage");
      const placement = item.schedule.type === "window" && covered
        ? windowPrecipitationRelation(item.schedule, hours.filter((h) => h.precipitationMillimeters > 0).map((h) => Date.parse(h.at) - 3600000)) : undefined;
      if (placement !== undefined) {
        facts.push({ type: "weather-placement", itemId, area: event.subject.area, phenomenon: "precipitation", relevance: placement });
        if (placement === "definite" && sensitive) attention = true;
      }
      let exposed = false;
      for (const h of hours) {
        const start = Date.parse(h.at) - 3600000, relation = areaScheduleOverlap(item.schedule, start, start + 3600000);
        if (relation === "none") continue;
        if (relation === "unknown") { uncertain(itemId, "schedule_precision"); continue; }
        exposed = true; reasons.add("weather_exposure");
        facts.push({ type: "weather-exposure", itemId, area: event.subject.area, relevance: relation,
          intervalStartAt: instantInZone(start, event.fact.timezone), intervalEndAt: instantInZone(start + 3600000, event.fact.timezone),
          sampleAt: instantInZone(Date.parse(h.at), event.fact.timezone),
          temperatureCelsius: h.temperatureCelsius, precipitationProbabilityPercent: h.precipitationProbabilityPercent,
          precipitationMillimeters: h.precipitationMillimeters, weatherCode: h.weatherCode });
        if (relation === "possible" && h.precipitationMillimeters > 0 && placement !== "definite") uncertain(itemId, "window_placement");
        if (relation === "date-only") uncertain(itemId, "schedule_precision");
        if (!sensitive) uncertain(itemId, "weather_sensitivity");
        else if (h.precipitationMillimeters > 0 && relation === "definite") attention = true;
      }
      if (!exposed) uncertain(itemId, "forecast_coverage");
    } else if (event.kind === "hazard" && event.fact.status === "observed") {
      // issuedAt is NOT a validity start/end. Only an observation during the schedule is related;
      // future applicability and exact facility coverage remain unproven even for emergency alerts.
      uncertain(itemId, "hazard_coverage"); uncertain(itemId, "hazard_validity");
      const relation = areaScheduleOverlap(item.schedule, observed, observed + 1);
      if (relation === "unknown") uncertain(itemId, "schedule_precision");
      for (const alert of event.fact.alerts) {
        if (Date.parse(alert.issuedAt) > observed) { uncertain(itemId, "external_data"); continue; }
        if (relation === "none" || relation === "unknown") continue;
        facts.push({ type: "hazard-exposure", itemId, area: event.subject.area, providerAlertId: alert.providerAlertId,
          category: alert.category, publicSeverity: alert.severity, issuedAt: alert.issuedAt, coverage: "query-limited",
          relevance: relation === "definite" ? "observed-during" : relation });
        reasons.add("hazard_exposure");
        // Advisory only: related regional observation, never a proof of facility danger.
        attention = true;
      }
    }
  }
  const uniqueFacts = [...new Map(facts.map((f) => [monitoringKey(f), f])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, f]) => f);
  const unknown = uniqueFacts.some((f) => f.type === "uncertainty");
  if (!reasons.size) reasons.add("no_material_change");
  const result: TripImpact = { id: "", tripId: trip.id, tripRevision: trip.revision, eventId: event.id, policyVersion: areaImpactPolicyVersion,
    facts: uniqueFacts, affectedItemIds: affected, evaluatedAt, status: attention ? "impact" : unknown ? "unknown" : "no-impact",
    severity: attention ? "attention" : "informational", reasonCodes: [...reasons].sort() };
  const complete = { ...result, id: tripImpactId(result) }; validateTripImpact(complete); return complete;
}
