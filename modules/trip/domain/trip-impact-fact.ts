import { exactKeys } from "./snapshot-validation";
import { validateZonedInstant, type ZonedInstant } from "./itinerary-schedule";
import { monitoringText } from "./trip-watch";
import { reservationId } from "./reservation";

export const railImpactUnknowns = ["external_data", "service_binding", "delay_missing", "movement_missing", "schedule_precision", "window_placement", "reservation_time", "destination_identity", "onward_arrival"] as const;
/** Measurements, not notification prose or provider payload. Departures of other services remain scheduled. */
export type TripImpactFact =
  | { readonly type: "rail-delay"; readonly itemId: string; readonly legId: string; readonly delayMinutes: number; readonly projectedDepartureAt: ZonedInstant; readonly projectedArrivalAt: ZonedInstant }
  | { readonly type: "connection-buffer"; readonly itemId: string; readonly fromLegId: string; readonly toLegId: string; readonly requiredMinutes: number; readonly scheduledMinutes: number; readonly projectedMinutes: number; readonly departureBasis: "scheduled" | "observed-service-delay" }
  | { readonly type: "schedule-risk"; readonly fromItemId: string; readonly toItemId: string; readonly projectedArrivalAt: ZonedInstant; readonly targetStartAt: ZonedInstant; readonly targetBasis: "fixed" | "window-latest-start" }
  | { readonly type: "reservation-risk"; readonly itemId: string; readonly reservationId: string; readonly projectedArrivalAt: ZonedInstant; readonly bookedStartAt: ZonedInstant }
  | { readonly type: "rail-observation"; readonly itemId: string; readonly legId: string; readonly observation: "cancelled" | "destination-unresolved" | "long-stop" }
  | { readonly type: "uncertainty"; readonly itemId: string; readonly reason: typeof railImpactUnknowns[number] };

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
      if (!railImpactUnknowns.includes(fact.reason)) throw new Error("Invalid uncertainty"); break;
    default: throw new Error("Unknown impact fact");
  }
  monitoringText(fact.itemId);
}
