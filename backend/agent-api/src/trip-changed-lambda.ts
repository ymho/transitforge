import { DynamoDbTripChangedOutbox } from "./adapters/dynamodb-trip-changed-outbox.js";
import { createRecheckProjection } from "./trip-recheck-composition-root.js";
import { TripChangedConsumer, type TripChangedMetrics } from "./usecases/trip-changed-consumer.js";

/** EventBridge only wakes the poller. No owner/event/Trip from its payload is consumed. */
export function trustedTick(event: unknown, ruleArn: string): boolean {
  const v = event as Record<string, unknown>;
  return !!ruleArn && !!v && v.source === "aws.events" && v["detail-type"] === "Scheduled Event" &&
    Array.isArray(v.resources) && v.resources.length === 1 && v.resources[0] === ruleArn &&
    !!v.detail && typeof v.detail === "object" && Object.keys(v.detail).length === 0 &&
    !Object.keys(v).some((k) => !["version", "id", "detail-type", "source", "account", "time", "region", "resources", "detail"].includes(k));
}
const metrics: TripChangedMetrics = { record(name, value) {
  console.log(JSON.stringify({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: "Raiquora/TripChanged", Dimensions: [[]],
    Metrics: [{ Name: name, Unit: name === "ProjectionLagMs" ? "Milliseconds" : "Count" }] }] }, [name]: value }));
} };
export async function handler(event: unknown, context: { getRemainingTimeInMillis(): number }) {
  if (!trustedTick(event, process.env.TRIP_CHANGED_RULE_ARN ?? "")) throw new Error("invalid-internal-trigger");
  const table = process.env.TRIP_TABLE_NAME;
  if (!table) throw new Error("missing-internal-configuration");
  // Existing TripWatchApplication is delegated to; durable task projection must succeed before outbox ACK.
  const watches = createRecheckProjection().projection;
  try { await new TripChangedConsumer(new DynamoDbTripChangedOutbox(table), watches, metrics).poll(() => context.getRemainingTimeInMillis()); }
  catch { throw new Error("trip-changed-poll-failed"); } // No SDK payload/private key in logs.
}
