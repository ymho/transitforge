import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { TripApplication } from "./usecases/trip-application.js";
import { DynamoDbReservationRepository } from "./adapters/dynamodb-reservation-repository.js";
import { ReservationApplication } from "./usecases/reservation-application.js";
import { ChecklistApplication } from "./usecases/checklist-application.js";
import { DynamoDbChecklistRepository } from "./adapters/dynamodb-checklist-repository.js";
import { DynamoDbTripWatchRepository } from "./adapters/dynamodb-trip-watch-repository.js";
import { TripWatchApplication, TripWatchWorker } from "./usecases/trip-watch-application.js";
import type { TripImpactEvaluator, WatchScopeResolver } from "./ports/trip-impact-evaluator.js";
import { DynamoDbTripSharing } from "./adapters/dynamodb-trip-sharing.js";
import { CryptographicShareSecret } from "./adapters/share-secret.js";
import { TripSharingApplication } from "./usecases/trip-sharing-application.js";

/** Install only in a host with reviewed end-user authentication and explicit confirmation authority. */
export function createAuthorizedTripApplications(table: string) {
  const trips = new DynamoDbTripRepository(table), sharingRepository = new DynamoDbTripSharing(table);
  const reservations = new ReservationApplication(trips, new DynamoDbReservationRepository(table));
  const sharing = new TripSharingApplication(trips, sharingRepository, new CryptographicShareSecret(), sharingRepository, undefined, reservations);
  return { sharing, trips: new TripApplication(trips, trips, undefined, reservations, undefined, sharing) };
}

/** IAM/internal worker composition only. Every operation still requires an explicit trusted owner. */
export function createInternalTripApplication(table: string): TripApplication {
  const repository = new DynamoDbTripRepository(table);
  return new TripApplication(repository, repository, undefined,
    new ReservationApplication(repository, new DynamoDbReservationRepository(table)));
}

/** Internal trusted import/booking host only. No Lambda/public authentication wiring. */
export function createInternalReservationApplication(table: string): ReservationApplication {
  return new ReservationApplication(new DynamoDbTripRepository(table), new DynamoDbReservationRepository(table));
}

/** No public route/writer. Principal and confirmation come from the trusted host. */
export function createInternalChecklistApplication(table: string): ChecklistApplication {
  const trips = new DynamoDbTripRepository(table);
  return new ChecklistApplication(trips, new DynamoDbChecklistRepository(table),
    new ReservationApplication(trips, new DynamoDbReservationRepository(table)));
}

/** Trusted owner-scoped worker seam only; #407 owns durable triggers, #394 owns the evaluator. */
export function createInternalTripWatch(table: string, evaluator: TripImpactEvaluator, scopes?: WatchScopeResolver) {
  const trips = new DynamoDbTripRepository(table), watches = new DynamoDbTripWatchRepository(table);
  return { application: new TripWatchApplication(trips, watches, scopes),
    worker: new TripWatchWorker(trips, watches, evaluator,
      new ReservationApplication(trips, new DynamoDbReservationRepository(table))) };
}
