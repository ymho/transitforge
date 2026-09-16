import { DynamoDbNotificationRepository, DynamoDbInAppDelivery } from "./adapters/dynamodb-notification-repository.js";
import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { DynamoDbTripImpactRepository } from "./adapters/dynamodb-trip-impact-repository.js";
import { notificationHash } from "./adapters/notification-record.js";
import { NotificationWorker } from "./usecases/notification-application.js";
import { trustedTick } from "./trip-changed-lambda.js";
import type { NotificationMetric } from "./ports/notification.js";

function record(name: NotificationMetric, value: number) {
  console.log(JSON.stringify({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: "Raiquora/Notification", Dimensions: [[]],
    Metrics: [{ Name: name, Unit: name.endsWith("Ms") ? "Milliseconds" : "Count" }] }] }, [name]: value }));
}
export async function handler(event: unknown, context: { getRemainingTimeInMillis(): number }) {
  if (!trustedTick(event, process.env.NOTIFICATION_RULE_ARN ?? "")) throw new Error("invalid-internal-trigger");
  try {
    const table = process.env.NOTIFICATION_TABLE_NAME, trips = process.env.TRIP_TABLE_NAME;
    if (!table || !trips) throw new Error();
    await new NotificationWorker(new DynamoDbNotificationRepository(table, trips), new DynamoDbTripRepository(trips),
      new DynamoDbTripImpactRepository(trips), new DynamoDbInAppDelivery(table, trips), notificationHash, { record }).poll(() => context.getRemainingTimeInMillis());
  } catch { throw new Error("notification-poll-failed"); }
}
