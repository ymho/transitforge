import { createRecheckWorker } from "./trip-recheck-composition-root.js";
import { trustedTick } from "./trip-changed-lambda.js";
import type { RecheckMetric } from "./ports/trip-recheck.js";
import type { TripImpactMetric } from "./usecases/trip-impact-application.js";

function record(namespace: string, name: RecheckMetric | TripImpactMetric, value: number) {
  console.log(JSON.stringify({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: namespace, Dimensions: [[]],
    Metrics: [{ Name: name, Unit: name.endsWith("Ms") ? "Milliseconds" : "Count" }] }] }, [name]: value }));
}
export async function handler(event: unknown, context: { getRemainingTimeInMillis(): number }) {
  if (!trustedTick(event, process.env.RECHECK_RULE_ARN ?? "")) throw new Error("invalid-internal-trigger");
  try {
    await createRecheckWorker({ record: (name, value) => record("Raiquora/TripRecheck", name, value) },
      { record: (name, value) => record("Raiquora/RailImpact", name, value) }).poll(() => context.getRemainingTimeInMillis());
  } catch { throw new Error("trip-recheck-poll-failed"); }
}
