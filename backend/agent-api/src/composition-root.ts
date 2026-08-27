import { HttpAccommodationProvider } from "./adapters/http-accommodation-provider.js";
import { OpenMeteoWeatherProvider } from "./adapters/open-meteo-weather-provider.js";
import { WikipediaPlaceMediaProvider } from "./adapters/wikipedia-place-media-provider.js";
import { AmadeusFlightProvider } from "./adapters/amadeus-flight-provider.js";
import { AwsBedrockConverseClient, AwsDynamoDbQueryClient, AwsS3Client, AwsSecretsManagerClient } from "./adapters/aws-sdk-clients.js";
import { BedrockConversationModel } from "./adapters/bedrock-conversation-model.js";
import { DynamoDbOperationSummaryRepository } from "./adapters/dynamodb-operation-summary.js";
import { S3JourneyDataRepository } from "./adapters/s3-journey-data.js";
import { S3PrivateObjectStorage } from "./adapters/s3-private-object-storage.js";
import { S3RepresentativeTimetableRepository } from "./adapters/s3-representative-timetable.js";
import { SecretsManagerTravelProviderCredentials } from "./adapters/secrets-manager-travel-provider-credentials.js";
import { SecretsManagerFlightProviderCredentials } from "./adapters/secrets-manager-flight-provider-credentials.js";
import { createAccommodationSearchOperation } from "./usecases/accommodation-search.js";
import { AgentApplication } from "./usecases/agent-application.js";
import { agentSystemPrompt } from "./usecases/agent-system-prompt.js";
import { createAgentTraceOperation } from "./usecases/agent-trace.js";
import { createBedrockConverseOperation } from "./usecases/bedrock-converse.js";
import { createConversationFeedbackOperation } from "./usecases/conversation-feedback.js";
import { createJourneySearchOperation } from "./usecases/journey-search.js";
import { createCongestionAnalysisOperation, createCongestionPeakOperation, createDelayAnalysisOperation } from "./usecases/operation-analysis.js";
import { createRepresentativeTimetableOperation } from "./usecases/representative-timetable.js";
import { createWeatherForecastOperation } from "./usecases/weather-forecast.js";
import { createPlaceMediaSearchOperation } from "./usecases/place-media-search.js";
import { createFlightSearchOperation } from "./usecases/flight-search.js";

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function createAgentApplication(environment: RuntimeEnvironment = process.env): AgentApplication {
  const log = (event: string, fields: Record<string, unknown>) => console.log(JSON.stringify({ event, ...fields }));
  const s3 = new AwsS3Client();
  const summary = new DynamoDbOperationSummaryRepository(new AwsDynamoDbQueryClient());
  const storage = new S3PrivateObjectStorage(s3);
  const timetableBucket = required(environment, "AI_TIMETABLE_BUCKET");
  const timetablePrefix = environment.AI_TIMETABLE_PREFIX ?? "ai-timetable";
  const journey = new S3JourneyDataRepository(s3, {
    indexBucket: timetableBucket,
    indexPrefix: environment.PLANNING_TIMETABLE_PREFIX ?? "timetable",
    snapshotBucket: required(environment, "TRAFFIC_SNAPSHOT_BUCKET"),
    snapshotKey: environment.TRAFFIC_SNAPSHOT_KEY ?? "api/traffic/delays.json",
  });
  const representativeTimetable = new S3RepresentativeTimetableRepository(s3, timetableBucket, timetablePrefix);
  const secrets = new AwsSecretsManagerClient();
  const secretArn = required(environment, "TRAVEL_PROVIDER_SECRET_ARN");
  const accommodationCredentials = new SecretsManagerTravelProviderCredentials(secrets, secretArn);
  const flightCredentials = new SecretsManagerFlightProviderCredentials(secrets, secretArn);
  const accommodation = new HttpAccommodationProvider({ fetch: globalThis.fetch }, accommodationCredentials);
  const weather = new OpenMeteoWeatherProvider({ fetch: globalThis.fetch });
  const places = new WikipediaPlaceMediaProvider({ fetch: globalThis.fetch });
  const flights = new AmadeusFlightProvider({ fetch: globalThis.fetch }, flightCredentials);
  const model = new BedrockConversationModel(new AwsBedrockConverseClient(), {
    modelId: environment.MODEL_ID ?? "amazon.nova-lite-v1:0",
    systemPrompt: agentSystemPrompt,
  });
  const operations = new Map([
    ["conversation_feedback", createConversationFeedbackOperation({ bucket: required(environment, "CONVERSATION_FEEDBACK_BUCKET"), storage, log })],
    ["agent_trace", createAgentTraceOperation({ bucket: required(environment, "AGENT_TRACE_BUCKET"), storage, log })],
    ["representative_timetable_search", createRepresentativeTimetableOperation(representativeTimetable)],
    ["journey_search", createJourneySearchOperation(journey, { log })],
    ["daily_congestion_analysis", createCongestionAnalysisOperation(summary, required(environment, "SUMMARY_TABLE"))],
    ["daily_congestion_peak", createCongestionPeakOperation(summary, required(environment, "SUMMARY_TABLE"))],
    ["train_delay_analysis", createDelayAnalysisOperation(summary, required(environment, "DELAY_SUMMARY_TABLE"))],
    ["travel_accommodation_search", createAccommodationSearchOperation(accommodation)],
    ["weather_forecast_search", createWeatherForecastOperation(weather)],
    ["place_media_search", createPlaceMediaSearchOperation(places)],
    ["flight_search", createFlightSearchOperation(flights)],
  ]);
  return new AgentApplication({ defaultOperation: createBedrockConverseOperation(model, log), operations, log });
}

function required(environment: RuntimeEnvironment, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
