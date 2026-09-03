import { HttpAccommodationProvider } from "./adapters/http-accommodation-provider.js";
import { OpenMeteoWeatherProvider } from "./adapters/open-meteo-weather-provider.js";
import { WikipediaPlaceMediaProvider } from "./adapters/wikipedia-place-media-provider.js";
import { EnrichedPlaceMediaProvider } from "./adapters/enriched-place-media-provider.js";
import { MapboxPlaceMediaProvider } from "./adapters/mapbox-place-media-provider.js";
import { BraveImagePlaceMediaProvider } from "./adapters/brave-image-place-media-provider.js";
import { AwsBedrockConverseClient, AwsDynamoDbQueryClient, AwsS3Client, AwsSecretsManagerClient } from "./adapters/aws-sdk-clients.js";
import { BedrockConversationModel } from "./adapters/bedrock-conversation-model.js";
import { DynamoDbOperationSummaryRepository } from "./adapters/dynamodb-operation-summary.js";
import { S3JourneyDataRepository } from "./adapters/s3-journey-data.js";
import { S3PrivateObjectStorage } from "./adapters/s3-private-object-storage.js";
import { S3RepresentativeTimetableRepository } from "./adapters/s3-representative-timetable.js";
import { SecretsManagerTravelProviderCredentials } from "./adapters/secrets-manager-travel-provider-credentials.js";
import { SecretsManagerMapboxSearchCredentials } from "./adapters/secrets-manager-mapbox-search-credentials.js";
import { SecretsManagerBraveSearchCredentials } from "./adapters/secrets-manager-brave-search-credentials.js";
import { BraveWebSearchProvider } from "./adapters/brave-web-search-provider.js";
import { SafeWebPageReader } from "./adapters/safe-web-page-reader.js";
import { JmaTravelAlertProvider } from "./adapters/jma-travel-alert-provider.js";
import { MapboxGroundAccessProvider } from "./adapters/mapbox-ground-access-provider.js";
import { createMapboxHttpClient } from "./adapters/mapbox-http-client.js";
import { HotPepperRestaurantProvider } from "./adapters/hot-pepper-restaurant-provider.js";
import { SecretsManagerHotPepperCredentials } from "./adapters/secrets-manager-hot-pepper-credentials.js";
import { createAccommodationSearchOperation } from "./usecases/accommodation-search.js";
import { AgentApplication } from "./usecases/agent-application.js";
import { agentSystemPrompt } from "./usecases/agent-system-prompt.js";
import { createAgentTraceOperation } from "./usecases/agent-trace.js";
import { createBedrockConverseOperation } from "./usecases/bedrock-converse.js";
import { StoredModelCallTraceRecorder } from "./usecases/model-call-trace.js";
import { createConversationFeedbackOperation } from "./usecases/conversation-feedback.js";
import { createJourneySearchOperation } from "./usecases/journey-search.js";
import { createCongestionAnalysisOperation, createCongestionPeakOperation, createDelayAnalysisOperation } from "./usecases/operation-analysis.js";
import { createRepresentativeTimetableOperation } from "./usecases/representative-timetable.js";
import { createWeatherForecastOperation } from "./usecases/weather-forecast.js";
import { createWeatherGridOperation } from "./usecases/weather-grid.js";
import { createPlaceMediaSearchOperation } from "./usecases/place-media-search.js";
import {
  createPlaceDetailResearchOperation,
  placeDetailResearchSystemPrompt,
} from "./usecases/place-detail-research.js";
import { createWebPageReadOperation, createWebSearchOperation } from "./usecases/web-research.js";
import { createTravelAlertSearchOperation } from "./usecases/travel-alert-search.js";
import { createGroundAccessSearchOperation } from "./usecases/ground-access-search.js";
import { createRestaurantSearchOperation } from "./usecases/restaurant-search.js";

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
  const accommodation = new HttpAccommodationProvider({ fetch: globalThis.fetch }, accommodationCredentials);
  const weather = new OpenMeteoWeatherProvider({ fetch: globalThis.fetch });
  const wikipediaPlaces = new WikipediaPlaceMediaProvider({ fetch: globalThis.fetch });
  const mapboxCredentials = new SecretsManagerMapboxSearchCredentials(secrets, secretArn);
  const mapboxHttp = createMapboxHttpClient(
    { fetch: globalThis.fetch },
    required(environment, "VIEWER_ORIGIN"),
  );
  const mapboxPlaces = new MapboxPlaceMediaProvider(mapboxHttp, mapboxCredentials);
  const webSearchCredentials = new SecretsManagerBraveSearchCredentials(secrets, secretArn);
  const webImages = new BraveImagePlaceMediaProvider({ fetch: globalThis.fetch }, webSearchCredentials);
  const places = new EnrichedPlaceMediaProvider(mapboxPlaces, webImages, () => new Date(), wikipediaPlaces);
  const webSearch = new BraveWebSearchProvider({ fetch: globalThis.fetch }, webSearchCredentials);
  const webPageReader = new SafeWebPageReader({ fetch: globalThis.fetch });
  const travelAlerts = new JmaTravelAlertProvider({ fetch: globalThis.fetch });
  const groundAccess = new MapboxGroundAccessProvider(mapboxHttp, mapboxCredentials);
  const restaurantCredentials = new SecretsManagerHotPepperCredentials(secrets, secretArn);
  const restaurants = new HotPepperRestaurantProvider({ fetch: globalThis.fetch }, restaurantCredentials);
  const lightweightModelId = optional(environment, "LIGHTWEIGHT_MODEL_ID");
  const decisionModelId = optional(environment, "DECISION_MODEL_ID");
  const traceBucket = required(environment, "AGENT_TRACE_BUCKET");
  const modelCallTraceRecorder = new StoredModelCallTraceRecorder({
    bucket: traceBucket,
    storage,
    log,
  });
  const bedrock = new AwsBedrockConverseClient();
  const model = new BedrockConversationModel(bedrock, {
    modelId: environment.MODEL_ID ?? "amazon.nova-lite-v1:0",
    ...(lightweightModelId === undefined ? {} : { lightweightModelId }),
    ...(decisionModelId === undefined ? {} : { decisionModelId }),
    systemPrompt: agentSystemPrompt,
    traceRecorder: modelCallTraceRecorder,
    log,
  });
  const placeDetailSummarizer = new BedrockConversationModel(bedrock, {
    modelId: environment.MODEL_ID ?? "amazon.nova-lite-v1:0",
    ...(decisionModelId === undefined ? {} : { decisionModelId }),
    systemPrompt: placeDetailResearchSystemPrompt,
    log,
  });
  const operations = new Map([
    ["conversation_feedback", createConversationFeedbackOperation({ bucket: required(environment, "CONVERSATION_FEEDBACK_BUCKET"), storage, log })],
    ["agent_trace", createAgentTraceOperation({ bucket: traceBucket, storage, log })],
    ["representative_timetable_search", createRepresentativeTimetableOperation(representativeTimetable)],
    ["journey_search", createJourneySearchOperation(journey, { log })],
    ["daily_congestion_analysis", createCongestionAnalysisOperation(summary, required(environment, "SUMMARY_TABLE"))],
    ["daily_congestion_peak", createCongestionPeakOperation(summary, required(environment, "SUMMARY_TABLE"))],
    ["train_delay_analysis", createDelayAnalysisOperation(summary, required(environment, "DELAY_SUMMARY_TABLE"))],
    ["travel_accommodation_search", createAccommodationSearchOperation(accommodation)],
    ["weather_forecast_search", createWeatherForecastOperation(weather)],
    ["weather_grid_search", createWeatherGridOperation(weather)],
    ["place_media_search", createPlaceMediaSearchOperation(places)],
    ["place_detail_research", createPlaceDetailResearchOperation({
      places,
      webSearch,
      webPageReader,
      summarizer: placeDetailSummarizer,
    })],
    ["web_search", createWebSearchOperation(webSearch)],
    ["web_page_read", createWebPageReadOperation(webPageReader)],
    ["travel_alert_search", createTravelAlertSearchOperation(travelAlerts)],
    ["ground_access_search", createGroundAccessSearchOperation(groundAccess)],
    ["restaurant_search", createRestaurantSearchOperation(restaurants)],
  ]);
  return new AgentApplication({ defaultOperation: createBedrockConverseOperation(model, log), operations, log });
}

function required(environment: RuntimeEnvironment, name: string): string {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(environment: RuntimeEnvironment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value ? value : undefined;
}
