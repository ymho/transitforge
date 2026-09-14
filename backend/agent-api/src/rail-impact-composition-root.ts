import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { DynamoDbTripWatchRepository } from "./adapters/dynamodb-trip-watch-repository.js";
import { DynamoDbRailImpactRouter } from "./adapters/dynamodb-rail-impact-router.js";
import { DynamoDbTripImpactRepository } from "./adapters/dynamodb-trip-impact-repository.js";
import { DynamoDbReservationRepository } from "./adapters/dynamodb-reservation-repository.js";
import { ReservationApplication } from "./usecases/reservation-application.js";
import { TripWatchWorker } from "./usecases/trip-watch-application.js";
import { RailTripImpactEvaluator } from "./usecases/rail-trip-impact-evaluator.js";
import { RailImpactApplication, type RailImpactMetrics } from "./usecases/rail-impact-application.js";

/** Dedicated IAM/internal composition. Never imported into the Agent/public HTTP entrypoint. */
export function createInternalRailImpact(table: string, metrics: RailImpactMetrics) {
  const trips = new DynamoDbTripRepository(table);
  const worker = new TripWatchWorker(trips, new DynamoDbTripWatchRepository(table), new RailTripImpactEvaluator(),
    new ReservationApplication(trips, new DynamoDbReservationRepository(table)));
  return new RailImpactApplication(new DynamoDbRailImpactRouter(table), worker, trips, new DynamoDbTripImpactRepository(table), metrics);
}
