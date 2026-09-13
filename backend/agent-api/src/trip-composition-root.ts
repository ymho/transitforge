import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { TripApplication } from "./usecases/trip-application.js";

/** IAM/internal worker composition only. Every operation still requires an explicit trusted owner. */
export function createInternalTripApplication(table: string): TripApplication {
  const repository = new DynamoDbTripRepository(table);
  return new TripApplication(repository, repository);
}
