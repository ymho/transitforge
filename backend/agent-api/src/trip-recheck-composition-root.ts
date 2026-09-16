import { AwsS3Client } from "./adapters/aws-sdk-clients.js";
import { DynamoDbTripRepository } from "./adapters/dynamodb-trip-repository.js";
import { DynamoDbTripWatchRepository } from "./adapters/dynamodb-trip-watch-repository.js";
import { DynamoDbTripRecheckRepository } from "./adapters/dynamodb-trip-recheck.js";
import { S3RecheckTargetCatalog } from "./adapters/s3-recheck-target-catalog.js";
import { TrustedRecheckTargetResolver } from "./adapters/recheck-target-resolver.js";
import { S3JourneyDataRepository } from "./adapters/s3-journey-data.js";
import { CollectorRecheckSource } from "./adapters/collector-recheck-source.js";
import { ProviderRecheckSource } from "./adapters/provider-recheck-source.js";
import { OpenMeteoWeatherProvider } from "./adapters/open-meteo-weather-provider.js";
import { JmaHazardAlertProvider } from "./adapters/jma-hazard-alert-provider.js";
import { TripRecheckProjection, TripRecheckWorker } from "./usecases/trip-recheck-application.js";
import type { RecheckMetrics } from "./ports/trip-recheck.js";
import type { TripImpactMetrics } from "./usecases/trip-impact-application.js";
import { createInternalTripImpact } from "./rail-impact-composition-root.js";

/** Internal entrypoints only. Agent composition never imports this module. */
export function createRecheckProjection(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const table = required(environment, "TRIP_TABLE_NAME"), s3 = new AwsS3Client();
  const trips = new DynamoDbTripRepository(table), watches = new DynamoDbTripWatchRepository(table);
  const tasks = new DynamoDbTripRecheckRepository(required(environment, "RECHECK_TABLE_NAME"));
  const targets = new TrustedRecheckTargetResolver(new S3RecheckTargetCatalog(s3, required(environment, "RECHECK_TARGET_BUCKET"), required(environment, "RECHECK_TARGET_KEY")));
  return { table, s3, trips, watches, tasks, targets, projection: new TripRecheckProjection(trips, watches, tasks, targets) };
}
export function createRecheckWorker(metrics: RecheckMetrics, impactMetrics: TripImpactMetrics, environment: Readonly<Record<string, string | undefined>> = process.env) {
  const c = createRecheckProjection(environment);
  const data = new S3JourneyDataRepository(c.s3, { indexBucket: required(environment, "AI_TIMETABLE_BUCKET"),
    indexPrefix: environment.PLANNING_TIMETABLE_PREFIX ?? "timetable", snapshotBucket: required(environment, "TRAFFIC_SNAPSHOT_BUCKET"),
    snapshotKey: environment.TRAFFIC_SNAPSHOT_KEY ?? "api/traffic/delays.json" });
  const source = new ProviderRecheckSource(c.targets, new OpenMeteoWeatherProvider({ fetch: globalThis.fetch }),
    new JmaHazardAlertProvider({ fetch: globalThis.fetch }), new CollectorRecheckSource(data));
  return new TripRecheckWorker(c.tasks, c.trips, c.watches, c.projection, source, createInternalTripImpact(c.table, impactMetrics), metrics);
}
function required(environment: Readonly<Record<string, string | undefined>>, key: string): string {
  const value = environment[key]; if (!value) throw new Error("missing-internal-configuration"); return value;
}
