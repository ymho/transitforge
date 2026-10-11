import { MapboxServiceAreaLookup } from "./adapters/mapbox-service-area-lookup.js";
import { serviceAreaSearchScope, ServiceAreaPolicy, serviceAreaPlaces, serviceAreaRestaurants, serviceAreaWebSearch, serviceAreaPages, serviceAreaKnowledge } from "./usecases/service-area.js";
import { VerifiedJourneySelections } from "./usecases/verified-journey-selection.js";
import { S3RepresentativeTimetableRepository } from "./adapters/s3-representative-timetable.js";
import { createRepresentativeTimetableOperation } from "./usecases/representative-timetable.js";
import { OpenMeteoWeatherProvider } from "./adapters/open-meteo-weather-provider.js";
import { WikipediaPlaceMediaProvider } from "./adapters/wikipedia-place-media-provider.js";
import { EnrichedPlaceMediaProvider } from "./adapters/enriched-place-media-provider.js";
import { MapboxPlaceMediaProvider } from "./adapters/mapbox-place-media-provider.js";
import { BraveImagePlaceMediaProvider } from "./adapters/brave-image-place-media-provider.js";
import { S3JourneyDataRepository } from "./adapters/s3-journey-data.js";
import { SecretsManagerMapboxSearchCredentials } from "./adapters/secrets-manager-mapbox-search-credentials.js";
import { SecretsManagerBraveSearchCredentials } from "./adapters/secrets-manager-brave-search-credentials.js";
import { BraveWebSearchProvider } from "./adapters/brave-web-search-provider.js";
import { SafeWebPageReader } from "./adapters/safe-web-page-reader.js";
import { JmaHazardAlertProvider } from "./adapters/jma-hazard-alert-provider.js";
import { MapboxGroundAccessProvider } from "./adapters/mapbox-ground-access-provider.js";
import { OtpGroundRouteProvider } from "./adapters/otp-ground-route-provider.js";
import { LambdaGroundRouteProvider } from "./adapters/lambda-ground-route-provider.js";
import { S3OtpGraphManifestRepository } from "./adapters/s3-otp-graph-manifest-repository.js";
import { S3StationCatalogRepository } from "./adapters/s3-station-catalog-repository.js";
import { railBusConnectionTool } from "./usecases/agent/rail-bus-connection-tool.js";
import { projectGroundRoutePresentation } from "./usecases/agent/project-ground-route-presentation.js";
import type { GroundRouteCoverage } from "./ports/ground-route-provider.js";
import { createMapboxHttpClient } from "./adapters/mapbox-http-client.js";
import { HotPepperRestaurantProvider } from "./adapters/hot-pepper-restaurant-provider.js";
import { SecretsManagerHotPepperCredentials } from "./adapters/secrets-manager-hot-pepper-credentials.js";
import { agentV2SystemPrompt } from "./usecases/agent-v2-system-prompt.js";
import { createJourneySearchOperation } from "./usecases/journey-search.js";
import { createPlaceMediaSearchOperation } from "./usecases/place-media-search.js";

import { createWebPageReadOperation, createWebSearchOperation } from "./usecases/web-research.js";
import { createHazardAlertSearchOperation } from "./usecases/hazard-alert-search.js";
import { createGroundAccessSearchOperation } from "./usecases/ground-access-search.js";
import { createRestaurantSearchOperation } from "./usecases/restaurant-search.js";

import { AwsS3Client, AwsSecretsManagerClient } from "./adapters/aws-sdk-clients.js";
import { createProductionConversationAgent } from "./composition/production-conversation-agent.js";
import { productionServerTools } from "./composition/production-server-tools.js";
import { createFixedEgressAccommodationOperation } from "./composition/fixed-egress-accommodation.js";
import { VerifiedAccommodationSelections } from "./usecases/verified-accommodation-selection.js";
import { rakutenAccommodationSelectionEvidence } from "./adapters/rakuten-accommodation-selection.js";
import { serverAgentDeadline } from "./composition/server-agent-deadline.js";
import type { AgentOperation } from "./ports/agent-operation.js";
import { WebTravelKnowledgeRetriever } from "./adapters/web-travel-knowledge-retriever.js";
import { BedrockKnowledgeRetriever } from "./adapters/bedrock-knowledge-retriever.js";
import { BedrockCandidateReranker } from "./adapters/bedrock-candidate-reranker.js";
import { createTravelDiscoveryOperation } from "./usecases/discover-travel-candidates.js";
import type { TravelKnowledgeRetriever } from "@raiquora/agent/travel-discovery";
import type { ResearchExecutionLedger } from "@raiquora/agent/research-execution";
import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import { projectPublicJourneyPresentation } from "@raiquora/agent/public-journey-presentation";
import { StrandsAgentEngine, strandsProductionReasoning } from "./adapters/strands-agent-engine.js";
import { createStrandsServerRuntime } from "./adapters/strands-server-runtime.js";

/** Constructed only after authentication, once per request. No Travel credentials or raw trace sink. */
export function createProductionServerAgent(executionId: string, environment: Readonly<Record<string, string | undefined>> = process.env) {
 const required = (key: string) => { const value = environment[key]; if (!value) throw new Error("Missing server configuration"); return value; };
 const maxExecutionMs = serverAgentDeadline(environment);
 if (environment.AGENT_RUNTIME !== undefined && environment.AGENT_RUNTIME !== "strands-v2") throw new Error("Invalid server runtime configuration");
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
 const serviceArea = new ServiceAreaPolicy(new MapboxServiceAreaLookup(mapboxHttp, mapboxCredentials));
 const places = serviceAreaPlaces(new EnrichedPlaceMediaProvider(new MapboxPlaceMediaProvider(mapboxHttp, mapboxCredentials),
   new BraveImagePlaceMediaProvider(http, webCredentials), () => new Date(), new WikipediaPlaceMediaProvider(http)), serviceArea);
 const weather = new OpenMeteoWeatherProvider(http);
 const webSearch = serviceAreaWebSearch(new BraveWebSearchProvider(http, webCredentials), serviceArea);
 const discoveryRetrievers: TravelKnowledgeRetriever[] = [new WebTravelKnowledgeRetriever(webSearch)];
 if (environment.TRAVEL_KNOWLEDGE_BASE_ID) discoveryRetrievers.push(new BedrockKnowledgeRetriever({
   knowledgeBaseId: environment.TRAVEL_KNOWLEDGE_BASE_ID,
   vectorStore: environment.TRAVEL_KNOWLEDGE_VECTOR_STORE === "opensearch_serverless_filterable_text" ? "opensearch_serverless_filterable_text" :
     environment.TRAVEL_KNOWLEDGE_VECTOR_STORE === "rds_filterable_text" ? "rds_filterable_text" :
       environment.TRAVEL_KNOWLEDGE_VECTOR_STORE === "mongodb_filterable_text" ? "mongodb_filterable_text" :
     environment.TRAVEL_KNOWLEDGE_VECTOR_STORE === "s3_vectors" ? "s3_vectors" : "other",
   requestedSearchType: environment.TRAVEL_KNOWLEDGE_SEARCH_TYPE === "HYBRID" ? "HYBRID" : "SEMANTIC",
 }));
 let turnResearchLedger: ResearchExecutionLedger | undefined;
 let verifiedJourneyResults: JourneySearchResponse[] = [];
 let groundRouteEvidence: Array<{ id: string; output: Record<string, unknown> }> = [];
 const discovery = createTravelDiscoveryOperation({ retrievers: discoveryRetrievers.map(retriever => serviceAreaKnowledge(retriever, serviceArea)), ledger: () => turnResearchLedger,
   ...(environment.BEDROCK_RERANK_MODEL_ARN ? { reranker: new BedrockCandidateReranker(environment.BEDROCK_RERANK_MODEL_ARN) } : {}) });
 const call = (operation: AgentOperation) => async (request: object) => {
   const result = await operation(request as Record<string, unknown>, { requestId: executionId });
   if ((result.statusCode ?? 200) >= 400) throw new Error("Provider unavailable");
   return result.body;
 };
 const restaurantSearch = createRestaurantSearchOperation(serviceAreaRestaurants(new HotPepperRestaurantProvider(http, new SecretsManagerHotPepperCredentials(secrets, secretArn)), serviceArea));
 const placeSearch = createPlaceMediaSearchOperation(places);
 const otp = otpConfiguration(environment);
 const otpBridge = otpBridgeConfiguration(environment);
 if (otp && otpBridge) throw new Error("Invalid OTP configuration");
 const groundRoutes = otp ? new OtpGroundRouteProvider(otp.endpoint, otp.coverage, http) : otpBridge
   ? new LambdaGroundRouteProvider(otpBridge.functionArn, new S3OtpGraphManifestRepository(s3,
     required("AI_TIMETABLE_BUCKET"), otpBridge.manifestKey, otpBridge.version, otpBridge.otpImage, otpBridge.graphSha256, otpBridge.regionId)) : undefined;
 const selectableJourneys = new VerifiedJourneySelections();
 const selectableAccommodations = new VerifiedAccommodationSelections();
 const railSearch = createJourneySearchOperation(journey, { onVerifiedResult: (result, index, retrievedAt) => {
   try { selectableJourneys.record(result, index, retrievedAt); }
   catch { /* A displayable result without complete selection provenance stays read-only. */ }
 } });
 const modelId = environment.MODEL_ID ?? "jp.amazon.nova-2-lite-v1:0";
 const runRuntime = createStrandsServerRuntime(new StrandsAgentEngine({
   modelId,
   region: required("AWS_REGION"),
   systemPrompt: `${agentV2SystemPrompt}
SERVICE AREA: The service accepts travel searches only in Japan, within these prefectures: ${serviceAreaSearchScope.prefectures.join("、")}. Do not recommend candidates elsewhere or invent candidates excluded by Tools. An empty filtered response does not prove that no facilities exist. This product boundary is separate from actual rail/OTP coverage.`,
   maxTurns: 10,
   maxOutputTokens: 4_096,
   maxInvocationOutputTokens: 4_096,
   ...strandsProductionReasoning(modelId),
 }));
 return createProductionConversationAgent({
   // Open-ended discovery needs several candidate/source/photo rounds and a
   // bounded final structured answer. The production Server budget is unchanged.
   limits: { maxIterations: 10, maxModelCalls: 14, maxToolCalls: 16, maxExecutionMs },
   detailedResearchAllowed: environment.AGENT_DETAILED_RESEARCH_ENABLED === "true",
   ...(environment.AGENT_DETAILED_RESEARCH_ENABLED === "true" ? { detailedResearchLimits: {
     maxIterations: boundedInteger(environment.AGENT_DETAILED_MAX_ITERATIONS, 6, 1, 12),
     maxModelCalls: boundedInteger(environment.AGENT_DETAILED_MAX_MODEL_CALLS, 8, 1, 16),
     maxToolCalls: boundedInteger(environment.AGENT_DETAILED_MAX_TOOL_CALLS, 16, 1, 32),
     maxExecutionMs: boundedInteger(environment.AGENT_DETAILED_DEADLINE_MS, Math.min(240_000, maxExecutionMs), 1_000, 270_000),
     maxEvidence: boundedInteger(environment.AGENT_DETAILED_MAX_EVIDENCE, 40, 1, 100),
   } } : {}),
   onResearchLedger: ledger => { turnResearchLedger = ledger; },
   projectResult: result => {
     const published = new Set(result.claims.filter(claim => claim.groundingStatus === "supported").flatMap(claim => claim.evidenceIds));
     const presentation = verifiedJourneyResults.map(search => projectPublicJourneyPresentation(search, published)).find(Boolean);
     const groundRoute = groundRouteEvidence.filter(entry => published.has(entry.id))
       .map(entry => projectGroundRoutePresentation(entry.id, entry.output)).find(Boolean);
     verifiedJourneyResults = [];
     groundRouteEvidence = [];
     return { ...(presentation ? { publicJourneyPresentation: presentation } : {}),
       ...(groundRoute ? { publicGroundRoutePresentation: groundRoute } : {}) };
   },
   verifiedSearchSelectionItems: result => [...selectableJourneys.itemsFor(result.publicJourneyPresentation),
     ...selectableAccommodations.itemsFor(result.publicAccommodationPresentation)],
   stateTable: required("SERVER_STATE_TABLE_NAME"), tripTable: required("TRIP_TABLE_NAME"),
   newExecutionId: () => executionId, weather,
   searchTripRestaurants: restaurantSearch,
   searchTripPlaces: placeSearch,
   ...(groundRoutes ? { tripGroundRoutes: groundRoutes } : {}),
   onGroundRouteEvidence: (id, output) => { groundRouteEvidence.push({ id, output }); },
   runRuntime,
   diagnostics: { record: async event => { console.info(JSON.stringify({ event: "agent_diagnostic", ...event })); } },
   log: (event, fields) => { console.warn(JSON.stringify({ event, ...fields })); },
   additionalTools: [...productionServerTools({
     discovery,
     journey: railSearch,
     representativeTimetable: createRepresentativeTimetableOperation(new S3RepresentativeTimetableRepository(s3, required("AI_TIMETABLE_BUCKET"), "ai-timetable")),
     accommodation: createFixedEgressAccommodationOperation(required("FIXED_EGRESS_PROVIDER_FUNCTION_ARN"), undefined, serviceArea),
     onAccommodationEvidence: (offerings, evidence, retrievedAt) => {
       const proofs = offerings.flatMap(offering => {
         const proof = rakutenAccommodationSelectionEvidence(offering, retrievedAt);
         return proof ? [proof] : [];
       });
       selectableAccommodations.record(offerings, proofs, evidence);
     },
     onJourneyResult: result => { verifiedJourneyResults.push(result); },
     external: {
       searchPlaceMedia: call(placeSearch),
       searchWeb: call(createWebSearchOperation(webSearch)),
       readWebPages: call(createWebPageReadOperation(serviceAreaPages(new SafeWebPageReader(http), serviceArea))),
       searchHazardAlerts: call(createHazardAlertSearchOperation(new JmaHazardAlertProvider(http))),
       searchGroundAccess: call(createGroundAccessSearchOperation(new MapboxGroundAccessProvider(mapboxHttp, mapboxCredentials))),
       searchRestaurants: call(restaurantSearch),
     },
   }), ...(groundRoutes ? [railBusConnectionTool(new S3StationCatalogRepository(s3, required("TRAFFIC_SNAPSHOT_BUCKET")), railSearch, groundRoutes)] : [])],
 });
}

/** Deploy both the private graph endpoint and an audited feed manifest together; never imply national coverage. */
function otpConfiguration(environment: Readonly<Record<string, string | undefined>>): { endpoint: string; coverage: GroundRouteCoverage } | undefined {
  const endpoint = environment.OTP_GRAPHQL_ENDPOINT, raw = environment.OTP_COVERAGE_JSON;
  if (!endpoint && !raw) return;
  if (!endpoint || !raw) throw new Error("Invalid OTP configuration");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Invalid OTP configuration"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid OTP configuration");
  const coverage = value as Record<string, unknown>, bounds = coverage.bounds as Record<string, unknown> | undefined;
  const date = (item: unknown) => typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(item) && !Number.isNaN(Date.parse(item));
  if (!bounds || ["south", "west", "north", "east"].some(key => typeof bounds[key] !== "number" || !Number.isFinite(bounds[key])) ||
      (bounds.south as number) >= (bounds.north as number) || (bounds.west as number) >= (bounds.east as number) ||
      !date(coverage.serviceStart) || !date(coverage.serviceEnd) || String(coverage.serviceStart) > String(coverage.serviceEnd) ||
      ![coverage.feedUrl, coverage.feedRetrievedAt, coverage.graphBuiltAt, coverage.attribution].every(item => typeof item === "string" && item.length > 0) ||
      !/^https?:\/\//u.test(endpoint)) throw new Error("Invalid OTP configuration");
  return { endpoint, coverage: coverage as unknown as GroundRouteCoverage };
}

function otpBridgeConfiguration(environment: Readonly<Record<string, string | undefined>>): {
  functionArn: string; manifestKey: string; version: string; otpImage: string; graphSha256: string; regionId: string;
} | undefined {
  const functionArn = environment.OTP_ROUTE_PROVIDER_FUNCTION_ARN, manifestKey = environment.OTP_GRAPH_MANIFEST_KEY,
    version = environment.OTP_GRAPH_VERSION, otpImage = environment.OTP_EXPECTED_IMAGE, graphSha256 = environment.OTP_EXPECTED_GRAPH_SHA;
  const regionId = environment.OTP_REGION_ID || "izumo-matsue";
  if (!functionArn && !manifestKey && !version && !otpImage && !graphSha256) return;
  if (!functionArn || !manifestKey || !version || !otpImage || !graphSha256 ||
      !/^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9-_]+$/u.test(functionArn) ||
      !/^[a-z][a-z0-9-]{2,63}$/u.test(regionId) || manifestKey !== `otp/${regionId}/versions/${version}/manifest.json` || !/^\d{8}T\d{6}Z-[0-9a-f]{12}$/u.test(version) ||
      !/^docker\.io\/opentripplanner\/opentripplanner@sha256:[0-9a-f]{64}$/u.test(otpImage) || !/^[0-9a-f]{64}$/u.test(graphSha256))
    throw new Error("Invalid OTP bridge configuration");
  return { functionArn, manifestKey, version, otpImage, graphSha256, regionId };
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/u.test(value)) throw new Error("Invalid server configuration");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("Invalid server configuration");
  return parsed;
}
