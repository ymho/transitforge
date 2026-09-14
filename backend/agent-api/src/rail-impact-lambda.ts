import { validateTravelEvent, type TravelEvent } from "@raiquora/trip/travel-event";
import { createInternalTripImpact } from "./rail-impact-composition-root.js";
import type { RailImpactMetrics } from "./usecases/rail-impact-application.js";

const metrics: RailImpactMetrics = { record(name, value) {
  console.log(JSON.stringify({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: "Raiquora/RailImpact", Dimensions: [[]],
    Metrics: [{ Name: name, Unit: name === "FanoutLagMs" ? "Milliseconds" : "Count" }] }] }, [name]: value }));
} };
/** IAM InvokeFunction only. Direct synchronous host receives replay receipt; no HTTP/auth substitute. */
export async function handler(input: unknown) {
  try {
    const event = input as TravelEvent;
    validateTravelEvent(event); // Owner/private/unknown fields rejected, no caller-selected routing.
    const table = process.env.TRIP_TABLE_NAME;
    if (!table) throw new Error();
    return await createInternalTripImpact(table, metrics).process(event);
  } catch { throw new Error("rail-impact-processing-failed"); }
}
