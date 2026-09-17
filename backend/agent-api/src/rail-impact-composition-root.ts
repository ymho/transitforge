import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { DynamoDbTripWatchRepository } from "./adapters/dynamodb-trip-watch-repository.js";
import { DynamoDbTripImpactRouter } from "./adapters/dynamodb-trip-impact-router.js";
import { DynamoDbTripImpactRepository } from "./adapters/dynamodb-trip-impact-repository.js";
import { DynamoDbReservationRepository } from "./adapters/dynamodb-reservation-repository.js";
import { ReservationApplication } from "./usecases/reservation-application.js";
import { TripWatchWorker } from "./usecases/trip-watch-application.js";
import { DeterministicTripImpactEvaluator } from "./usecases/trip-impact-evaluator.js";
import { TripImpactApplication, type TripImpactMetrics } from "./usecases/trip-impact-application.js";

/** Dedicated IAM/internal composition. Never imported into the Agent/public HTTP entrypoint. */
export function createInternalTripImpact(table: string, metrics: TripImpactMetrics) {
  const notificationTable = process.env.NOTIFICATION_TABLE_NAME;
  if (!notificationTable) throw new Error("missing-internal-configuration");
  const trips = new DynamoDbTripRepository(table);
  const worker = new TripWatchWorker(trips, new DynamoDbTripWatchRepository(table), new DeterministicTripImpactEvaluator(),
    new ReservationApplication(trips, new DynamoDbReservationRepository(table)));
  return new TripImpactApplication(new DynamoDbTripImpactRouter(table), worker, trips, new DynamoDbTripImpactRepository(table, undefined, notificationTable), metrics);
}
export const createInternalRailImpact = createInternalTripImpact;
