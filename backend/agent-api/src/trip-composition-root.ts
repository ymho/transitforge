import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { TripApplication } from "./usecases/trip-application.js";
import { DynamoDbReservationRepository } from "./adapters/dynamodb-reservation-repository.js";
import { ReservationApplication } from "./usecases/reservation-application.js";
import { ChecklistApplication } from "./usecases/checklist-application.js";
import { DynamoDbChecklistRepository } from "./adapters/dynamodb-checklist-repository.js";

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
