import { S3RepresentativeTimetableRepository } from "./adapters/s3-representative-timetable.js";
import { createRepresentativeTimetableOperation } from "./usecases/representative-timetable.js";
import { OpenMeteoWeatherProvider } from "./adapters/open-meteo-weather-provider.js";
import { WikipediaPlaceMediaProvider } from "./adapters/wikipedia-place-media-provider.js";
import { EnrichedPlaceMediaProvider } from "./adapters/enriched-place-media-provider.js";
import { MapboxPlaceMediaProvider } from "./adapters/mapbox-place-media-provider.js";
import { BraveImagePlaceMediaProvider } from "./adapters/brave-image-place-media-provider.js";
import { BedrockConversationModel } from "./adapters/bedrock-conversation-model.js";
import { S3JourneyDataRepository } from "./adapters/s3-journey-data.js";
import { SecretsManagerMapboxSearchCredentials } from "./adapters/secrets-manager-mapbox-search-credentials.js";
import { SecretsManagerBraveSearchCredentials } from "./adapters/secrets-manager-brave-search-credentials.js";
import { BraveWebSearchProvider } from "./adapters/brave-web-search-provider.js";
import { SafeWebPageReader } from "./adapters/safe-web-page-reader.js";
import { JmaHazardAlertProvider } from "./adapters/jma-hazard-alert-provider.js";
import { MapboxGroundAccessProvider } from "./adapters/mapbox-ground-access-provider.js";
import { createMapboxHttpClient } from "./adapters/mapbox-http-client.js";
import { HotPepperRestaurantProvider } from "./adapters/hot-pepper-restaurant-provider.js";
import { SecretsManagerHotPepperCredentials } from "./adapters/secrets-manager-hot-pepper-credentials.js";
import { agentSystemPrompt } from "./usecases/agent-system-prompt.js";
import { createJourneySearchOperation } from "./usecases/journey-search.js";
import { createPlaceMediaSearchOperation } from "./usecases/place-media-search.js";

import { createWebPageReadOperation, createWebSearchOperation } from "./usecases/web-research.js";
import { createHazardAlertSearchOperation } from "./usecases/hazard-alert-search.js";
import { createGroundAccessSearchOperation } from "./usecases/ground-access-search.js";
import { createRestaurantSearchOperation } from "./usecases/restaurant-search.js";

import { AwsBedrockConverseClient, AwsS3Client, AwsSecretsManagerClient } from "./adapters/aws-sdk-clients.js";
import { createProductionConversationAgent } from "./composition/production-conversation-agent.js";
import { productionServerTools } from "./composition/production-server-tools.js";
import { createFixedEgressAccommodationOperation } from "./composition/fixed-egress-accommodation.js";
import type { AgentOperation } from "./ports/agent-operation.js";

/** Constructed only after authentication, once per request. No Travel credentials or raw trace sink. */
export function createProductionServerAgent(executionId: string, environment: Readonly<Record<string, string | undefined>> = process.env) {
 const required = (key: string) => { const value = environment[key]; if (!value) throw new Error("Missing server configuration"); return value; };
 const s3 = new AwsS3Client();
 const journey = new S3JourneyDataRepository(s3, { indexBucket: required("AI_TIMETABLE_BUCKET"),
   indexPrefix: environment.PLANNING_TIMETABLE_PREFIX ?? "timetable", snapshotBucket: required("TRAFFIC_SNAPSHOT_BUCKET"),
   snapshotKey: "api/traffic/delays.json" });
 const secrets = new AwsSecretsManagerClient();
 // Dedicated non-travel secret: do not grant the old mixed secret to this role.
 const secretArn = required("AGENT_PROVIDER_SECRET_ARN");
 const mapboxCredentials = new SecretsManagerMapboxSearchCredentials(secrets, secretArn);
 const webCredentials = new SecretsManagerBraveSearchCredentials(secrets, secretArn);
 const http = { fetch: globalThis.fetch };
 const mapboxHttp = createMapboxHttpClient(http, required("VIEWER_ORIGIN"));
 const places = new EnrichedPlaceMediaProvider(new MapboxPlaceMediaProvider(mapboxHttp, mapboxCredentials),
   new BraveImagePlaceMediaProvider(http, webCredentials), () => new Date(), new WikipediaPlaceMediaProvider(http));
 const weather = new OpenMeteoWeatherProvider(http);
 const call = (operation: AgentOperation) => async (request: object) => {
   const result = await operation(request as Record<string, unknown>, { requestId: executionId });
   if ((result.statusCode ?? 200) >= 400) throw new Error("Provider unavailable");
   return result.body;
 };
 return createProductionConversationAgent({
   stateTable: required("SERVER_STATE_TABLE_NAME"), tripTable: required("TRIP_TABLE_NAME"),
   newExecutionId: () => executionId, weather,
   model: new BedrockConversationModel(new AwsBedrockConverseClient(), {
     modelId: environment.MODEL_ID ?? "amazon.nova-lite-v1:0", lightweightModelId: environment.LIGHTWEIGHT_MODEL_ID || undefined,
     decisionModelId: environment.DECISION_MODEL_ID || undefined, systemPrompt: agentSystemPrompt,
   }),
   additionalTools: productionServerTools({
     journey: createJourneySearchOperation(journey),
     representativeTimetable: createRepresentativeTimetableOperation(new S3RepresentativeTimetableRepository(s3, required("AI_TIMETABLE_BUCKET"), "ai-timetable")),
     accommodation: createFixedEgressAccommodationOperation(required("FIXED_EGRESS_PROVIDER_FUNCTION_ARN")),
     external: {
       searchPlaceMedia: call(createPlaceMediaSearchOperation(places)),
       searchWeb: call(createWebSearchOperation(new BraveWebSearchProvider(http, webCredentials))),
       readWebPages: call(createWebPageReadOperation(new SafeWebPageReader(http))),
       searchHazardAlerts: call(createHazardAlertSearchOperation(new JmaHazardAlertProvider(http))),
       searchGroundAccess: call(createGroundAccessSearchOperation(new MapboxGroundAccessProvider(mapboxHttp, mapboxCredentials))),
       searchRestaurants: call(createRestaurantSearchOperation(new HotPepperRestaurantProvider(http, new SecretsManagerHotPepperCredentials(secrets, secretArn)))),
     },
   }),
 });
}
