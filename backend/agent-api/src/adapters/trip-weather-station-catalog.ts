import { S3Client } from "@aws-sdk/client-s3";
import { AwsS3Client } from "./aws-sdk-clients.js";
import { S3StationCatalogRepository } from "./s3-station-catalog-repository.js";
/** Bound interactive station lookup; no SDK type escapes into Application/composition. */
export function createTripWeatherStationCatalog(bucket: string) {
  return new S3StationCatalogRepository(new AwsS3Client(new S3Client({ maxAttempts: 1,
    requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 } })), bucket);
}
