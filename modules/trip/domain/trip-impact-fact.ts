import { exactKeys, validInstant } from "./snapshot-validation";
import { validateZonedInstant, type ZonedInstant } from "./itinerary-schedule";
import { monitoringText } from "./trip-watch";
import { reservationId } from "./reservation";
import { hazardAlertCategories, hazardAlertSeverities, type HazardAlertCategory, type HazardAlertSeverity } from "./hazard-alert";
import { validateWeatherMeasurements } from "./weather-event-fact";

export const railImpactUnknowns = ["external_data", "service_binding", "delay_missing", "movement_missing", "schedule_precision", "window_placement", "reservation_time", "destination_identity", "onward_arrival"] as const;
export const areaImpactUnknowns = ["area_binding", "forecast_coverage", "weather_sensitivity", "hazard_coverage", "hazard_validity"] as const;
/** Measurements, not notification prose or provider payload. Departures of other services remain scheduled. */
export type TripImpactFact =
  | { readonly type: "rail-delay"; readonly itemId: string; readonly legId: string; readonly delayMinutes: number; readonly projectedDepartureAt: ZonedInstant; readonly projectedArrivalAt: ZonedInstant }
  | { readonly type: "connection-buffer"; readonly itemId: string; readonly fromLegId: string; readonly toLegId: string; readonly requiredMinutes: number; readonly scheduledMinutes: number; readonly projectedMinutes: number; readonly departureBasis: "scheduled" | "observed-service-delay" }
  | { readonly type: "schedule-risk"; readonly fromItemId: string; readonly toItemId: string; readonly projectedArrivalAt: ZonedInstant; readonly targetStartAt: ZonedInstant; readonly targetBasis: "fixed" | "window-latest-start" }
  | { readonly type: "reservation-risk"; readonly itemId: string; readonly reservationId: string; readonly projectedArrivalAt: ZonedInstant; readonly bookedStartAt: ZonedInstant }
  | { readonly type: "rail-observation"; readonly itemId: string; readonly legId: string; readonly observation: "cancelled" | "destination-unresolved" | "long-stop" }
  | { readonly type: "uncertainty"; readonly itemId: string; readonly reason: typeof railImpactUnknowns[number] | typeof areaImpactUnknowns[number] }
  | { readonly type: "weather-exposure"; readonly itemId: string; readonly area: string;
      readonly intervalStartAt: ZonedInstant; readonly intervalEndAt: ZonedInstant; readonly sampleAt: ZonedInstant;
      readonly relevance: "definite" | "possible" | "date-only";
      readonly temperatureCelsius: number; readonly precipitationProbabilityPercent: number;
      readonly precipitationMillimeters: number; readonly weatherCode: number }
  | { readonly type: "weather-placement"; readonly itemId: string; readonly area: string;
      readonly phenomenon: "precipitation"; readonly relevance: "definite" | "possible" | "none" }
  | { readonly type: "hazard-exposure"; readonly itemId: string; readonly area: string;
      readonly providerAlertId: string; readonly category: HazardAlertCategory; readonly publicSeverity: HazardAlertSeverity;
      readonly issuedAt: string; readonly coverage: "query-limited";
      readonly relevance: "observed-during" | "possible" | "date-only" };

export function validateTripImpactFact(fact: TripImpactFact): void {
  const numbers = (...values: number[]) => { if (values.some((v) => !Number.isFinite(v))) throw new Error("Invalid impact measurement"); };
  switch (fact.type) {
    case "rail-delay":
      exactKeys(fact, ["type", "itemId", "legId", "delayMinutes", "projectedDepartureAt", "projectedArrivalAt"]);
      monitoringText(fact.legId); numbers(fact.delayMinutes);
      if (fact.delayMinutes < 0) throw new Error("Negative delay");
      validateZonedInstant(fact.projectedDepartureAt); validateZonedInstant(fact.projectedArrivalAt);
      if (Date.parse(fact.projectedArrivalAt.at) < Date.parse(fact.projectedDepartureAt.at)) throw new Error("Invalid projection order");
      break;
    case "connection-buffer":
      exactKeys(fact, ["type", "itemId", "fromLegId", "toLegId", "requiredMinutes", "scheduledMinutes", "projectedMinutes", "departureBasis"]);
      monitoringText(fact.fromLegId); monitoringText(fact.toLegId); numbers(fact.requiredMinutes, fact.scheduledMinutes, fact.projectedMinutes);
      if (fact.requiredMinutes < 0 || fact.scheduledMinutes < fact.requiredMinutes || !["scheduled", "observed-service-delay"].includes(fact.departureBasis)) throw new Error("Invalid transfer measurement");
      break;
    case "schedule-risk":
      exactKeys(fact, ["type", "fromItemId", "toItemId", "projectedArrivalAt", "targetStartAt", "targetBasis"]);
      monitoringText(fact.fromItemId); monitoringText(fact.toItemId);
      validateZonedInstant(fact.projectedArrivalAt); validateZonedInstant(fact.targetStartAt);
      if (!["fixed", "window-latest-start"].includes(fact.targetBasis) || fact.fromItemId === fact.toItemId ||
          Date.parse(fact.projectedArrivalAt.at) <= Date.parse(fact.targetStartAt.at)) throw new Error("Invalid target risk");
      return;
    case "reservation-risk":
      exactKeys(fact, ["type", "itemId", "reservationId", "projectedArrivalAt", "bookedStartAt"]);
      reservationId(fact.reservationId); validateZonedInstant(fact.projectedArrivalAt); validateZonedInstant(fact.bookedStartAt);
      if (Date.parse(fact.projectedArrivalAt.at) <= Date.parse(fact.bookedStartAt.at)) throw new Error("Invalid reservation risk"); break;
    case "rail-observation":
      exactKeys(fact, ["type", "itemId", "legId", "observation"]); monitoringText(fact.legId);
      if (!["cancelled", "destination-unresolved", "long-stop"].includes(fact.observation)) throw new Error("Invalid rail observation"); break;
    case "uncertainty":
      exactKeys(fact, ["type", "itemId", "reason"]);
      if (!([...railImpactUnknowns, ...areaImpactUnknowns] as readonly string[]).includes(fact.reason)) throw new Error("Invalid uncertainty"); break;
    case "weather-exposure":
      exactKeys(fact, ["type", "itemId", "area", "intervalStartAt", "intervalEndAt", "sampleAt", "relevance", "temperatureCelsius", "precipitationProbabilityPercent", "precipitationMillimeters", "weatherCode"]);
      monitoringText(fact.area); validateZonedInstant(fact.intervalStartAt); validateZonedInstant(fact.intervalEndAt); validateZonedInstant(fact.sampleAt);
      if (Date.parse(fact.intervalEndAt.at) - Date.parse(fact.intervalStartAt.at) !== 3600000 ||
          Date.parse(fact.sampleAt.at) !== Date.parse(fact.intervalEndAt.at) ||
          !["definite", "possible", "date-only"].includes(fact.relevance)) throw new Error("Invalid weather interval");
      validateWeatherMeasurements(fact); break;
    case "weather-placement":
      exactKeys(fact, ["type", "itemId", "area", "phenomenon", "relevance"]); monitoringText(fact.area);
      if (fact.phenomenon !== "precipitation" || !["definite", "possible", "none"].includes(fact.relevance)) throw new Error("Invalid weather placement"); break;
    case "hazard-exposure":
      exactKeys(fact, ["type", "itemId", "area", "providerAlertId", "category", "publicSeverity", "issuedAt", "coverage", "relevance"]);
      monitoringText(fact.area); monitoringText(fact.providerAlertId, 300);
      if (!hazardAlertCategories.includes(fact.category) || !hazardAlertSeverities.includes(fact.publicSeverity) || !validInstant(fact.issuedAt) ||
          fact.coverage !== "query-limited" || !["observed-during", "possible", "date-only"].includes(fact.relevance)) throw new Error("Invalid hazard exposure"); break;
    default: throw new Error("Unknown impact fact");
  }
  monitoringText(fact.itemId);
}
