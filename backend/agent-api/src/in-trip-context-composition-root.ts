import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { DynamoDbNotificationRepository } from "./adapters/dynamodb-notification-repository.js";
import { DynamoDbTripImpactRepository } from "./adapters/dynamodb-trip-impact-repository.js";
import { DynamoDbReservationRepository } from "./adapters/dynamodb-reservation-repository.js";
import { ReservationApplication } from "./usecases/reservation-application.js";
import { NotificationApplication } from "./usecases/notification-application.js";
import { InTripContextApplication } from "./usecases/in-trip-context-application.js";

/** For a reviewed authenticated read host only. Public Lambda does NOT install this composition. */
export function createInTripContextApplication(tripTable: string, notificationTable: string) {
  if (!tripTable || !notificationTable) throw new Error("Missing read configuration");
  const trips = new DynamoDbTripRepository(tripTable), observations = new DynamoDbNotificationRepository(notificationTable, tripTable);
  return new InTripContextApplication(trips, observations, new DynamoDbTripImpactRepository(tripTable),
    new ReservationApplication(trips, new DynamoDbReservationRepository(tripTable)), new NotificationApplication(observations, trips));
}
