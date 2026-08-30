import type {
  BedrockAgentMessage,
  BedrockAgentResponse,
  AccommodationSearchResponse,
  DailyCongestionAnalysisResponse,
  DailyCongestionPeakResponse,
  RepresentativeTimetableKind,
  RepresentativeTimetableSearchMode,
  RepresentativeTimetableSearchResponse,
  TrainDelayAnalysisResponse,
  TravelCandidateSearchResponse,
  WeatherForecastSearchResponse,
  WeatherGridSearchResponse,
  PlaceMediaSearchResponse,
  TravelAlertSearchResponse,
  GroundAccessSearchResponse,
  RestaurantSearchResponse,
  WebSearchResponse,
  WebPageReadResponse,
} from "./bedrock-agent-contract";
import {
  isBedrockAgentResponse,
  isAccommodationSearchResponse,
  isDailyCongestionAnalysisResponse,
  isDailyCongestionPeakResponse,
  isRepresentativeTimetableSearchResponse,
  isTrainDelayAnalysisResponse,
  isTravelCandidateSearchResponse,
  isWeatherForecastSearchResponse,
  isWeatherGridSearchResponse,
  isPlaceMediaSearchResponse,
  isTravelAlertSearchResponse,
  isGroundAccessSearchResponse,
  isRestaurantSearchResponse,
  isWebSearchResponse,
  isWebPageReadResponse,
} from "./bedrock-agent-validation";
import type {
  JourneySearchRequest,
  JourneySearchService,
} from "@raiquora/journey/journey-search-service";
import type { AgentToolDescriptor } from "../../../usecases/agent/tool-contract";
import type { AgentModelClass } from "../../../usecases/agent/model-provider";
import type { AgentTrace } from "../../../usecases/agent/agent-trace";
import type { ConversationFeedbackV2 } from "../../../usecases/concierge/conversation-feedback";
import {
  journeySearchContractVersion,
  toJourneySearchResponse,
} from "./journey-search-contract";

export type * from "./bedrock-agent-contract";

export interface AgentResponseMetadata {
  requestId?: string;
}

export interface AgentApiResult<T> {
  body: T;
  metadata: AgentResponseMetadata;
}

export async function submitConversationFeedback(
  feedback: ConversationFeedbackV2,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const body = JSON.stringify({ operation: "conversation_feedback", ...feedback });
  const response = await fetcher("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Amz-Content-Sha256": await sha256Hex(body) },
    body,
  });
  if (!response.ok) throw new Error("フィードバックを保存できませんでした。");
}

export interface AgentTraceSubmission {
  taskId: string;
  requestIds: string[];
  trace: AgentTrace;
}

export interface AgentTraceStoredResponse {
  traceId: string;
  eventCount: number;
}

export const maximumStoredAgentTraceEvents = 100;

export async function submitAgentTrace(
  submission: AgentTraceSubmission,
  fetcher: typeof fetch = fetch,
): Promise<AgentApiResult<AgentTraceStoredResponse>> {
  const omittedEventCount = Math.max(
    0,
    submission.trace.events.length - maximumStoredAgentTraceEvents,
  );
  return postAgent(
    {
      operation: "agent_trace",
      ...submission,
      trace: {
        ...submission.trace,
        events: submission.trace.events.slice(0, maximumStoredAgentTraceEvents),
        droppedEventCount:
          submission.trace.droppedEventCount + omittedEventCount,
      },
    },
    "Agent Traceを保存できません",
    "Agent Trace",
    isAgentTraceStoredResponse,
    fetcher,
  );
}

export async function invokeBedrockAgent(
  messages: BedrockAgentMessage[],
  fetcher: typeof fetch = fetch,
  tools?: AgentToolDescriptor[],
  modelClass?: AgentModelClass,
): Promise<AgentApiResult<BedrockAgentResponse>> {
  return postAgent(
    {
      messages,
      ...(tools === undefined ? {} : { toolDefinitions: tools }),
      ...(modelClass === undefined ? {} : { modelClass }),
    },
    "AI案内APIを利用できません",
    "AI案内",
    isBedrockAgentResponse,
    fetcher,
    true,
  );
}

export async function queryDailyCongestionPeak(serviceDate: string, fetcher: typeof fetch = fetch): Promise<DailyCongestionPeakResponse> {
  return postAgentBody({ operation: "daily_congestion_peak", serviceDate }, "混雑履歴を取得できません", "混雑履歴", isDailyCongestionPeakResponse, fetcher);
}

export async function queryDailyCongestionAnalysis(serviceDate: string, fetcher: typeof fetch = fetch): Promise<DailyCongestionAnalysisResponse> {
  return postAgentBody({ operation: "daily_congestion_analysis", serviceDate }, "混雑分析を取得できません", "混雑分析", isDailyCongestionAnalysisResponse, fetcher);
}

export async function queryTrainDelayAnalysis(serviceDate: string, fetcher: typeof fetch = fetch): Promise<TrainDelayAnalysisResponse> {
  return postAgentBody({ operation: "train_delay_analysis", serviceDate }, "列車遅延分析を取得できません", "列車遅延分析", isTrainDelayAnalysisResponse, fetcher);
}

export async function searchAccommodations(
  request: { destination: string; checkInDate: string; checkOutDate: string; adults?: number; limit?: number },
  fetcher: typeof fetch = fetch,
): Promise<AccommodationSearchResponse> {
  return postAgentBody(
    { operation: "travel_accommodation_search", ...request },
    "宿泊候補を検索できません",
    "宿泊候補",
    isAccommodationSearchResponse,
    fetcher,
    true,
  );
}

export async function searchWeatherForecast(
  request: { location: string; startDate?: string; endDate?: string },
  fetcher: typeof fetch = fetch,
): Promise<WeatherForecastSearchResponse> {
  return postAgentBody(
    { operation: "weather_forecast_search", ...request },
    "天気予報を検索できません",
    "天気予報",
    isWeatherForecastSearchResponse,
    fetcher,
    true,
  );
}

export async function searchWeatherGrid(
  request: {
    points: import("@raiquora/trip/weather-grid").WeatherGridPoint[];
    targetTime?: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<WeatherGridSearchResponse> {
  return postAgentBody(
    { operation: "weather_grid_search", ...request },
    "局地天気を取得できません",
    "局地天気",
    isWeatherGridSearchResponse,
    fetcher,
    true,
  );
}

export async function searchPlaceMedia(
  request: { query: string; latitude?: number; longitude?: number; radiusMeters?: number; limit?: number; detail?: boolean },
  fetcher: typeof fetch = fetch,
): Promise<PlaceMediaSearchResponse> {
  return postAgentBody(
    { operation: "place_media_search", ...request },
    "観光地情報を検索できません",
    "観光地情報",
    isPlaceMediaSearchResponse,
    fetcher,
    true,
  );
}

export async function searchTravelAlerts(
  request: { area: string; categories?: import("@raiquora/trip/travel-alert").TravelAlertCategory[]; limit?: number },
  fetcher: typeof fetch = fetch,
): Promise<TravelAlertSearchResponse> {
  return postAgentBody(
    { operation: "travel_alert_search", ...request },
    "防災情報を取得できません",
    "防災情報",
    isTravelAlertSearchResponse,
    fetcher,
    true,
  );
}

export async function searchGroundAccess(
  request: {
    action: "route" | "matrix" | "isochrone";
    mode: import("@raiquora/trip/ground-access").GroundAccessMode;
    origin: import("@raiquora/trip/ground-access").GroundAccessPoint;
    destinations?: import("@raiquora/trip/ground-access").GroundAccessPoint[];
    minutes?: number;
  },
  fetcher: typeof fetch = fetch,
): Promise<GroundAccessSearchResponse> {
  return postAgentBody({ operation: "ground_access_search", ...request }, "駅から先の移動を検索できません", "徒歩と車の移動", isGroundAccessSearchResponse, fetcher, true);
}

export async function searchRestaurants(
  request: { area: string; keyword?: string; latitude?: number; longitude?: number; range?: 1 | 2 | 3 | 4 | 5; requirements?: import("@raiquora/trip/restaurant-search").RestaurantRequirements; limit?: number },
  fetcher: typeof fetch = fetch,
): Promise<RestaurantSearchResponse> {
  return postAgentBody({ operation: "restaurant_search", ...request }, "飲食店候補を検索できません", "飲食店候補", isRestaurantSearchResponse, fetcher, true);
}

export async function searchWeb(
  request: { query: string; freshness?: "day" | "week" | "month" | "year"; domains?: string[]; limit?: number },
  fetcher: typeof fetch = fetch,
): Promise<WebSearchResponse> {
  return postAgentBody({ operation: "web_search", ...request }, "Web情報を検索できません", "Web検索", isWebSearchResponse, fetcher, true);
}

export async function readWebPages(
  request: { urls: string[] },
  fetcher: typeof fetch = fetch,
): Promise<WebPageReadResponse> {
  return postAgentBody({ operation: "web_page_read", ...request }, "Webページを確認できません", "Webページ", isWebPageReadResponse, fetcher, true);
}

export async function searchRepresentativeTimetable(
  request: {
    timetableKind: RepresentativeTimetableKind;
    query: string;
    mode: RepresentativeTimetableSearchMode;
    targetTimeMinutes?: number;
    limit?: number;
  },
  fetcher: typeof fetch = fetch,
): Promise<RepresentativeTimetableSearchResponse> {
  return postAgentBody(
    { operation: "representative_timetable_search", ...request },
    "代表ダイヤを検索できません",
    "代表ダイヤ",
    isRepresentativeTimetableSearchResponse,
    fetcher,
  );
}

export async function searchTravelCandidates(
  request: JourneySearchRequest,
  fetcher: typeof fetch = fetch,
): Promise<TravelCandidateSearchResponse> {
  const response = await postAgentBody(
    {
      operation: "journey_search",
      contractVersion: journeySearchContractVersion,
      maxTransfers: 3,
      ...request,
    },
    "旅行候補を検索できません",
    "旅行候補",
    isTravelCandidateSearchResponse,
    fetcher,
    true,
  );
  return toJourneySearchResponse(response);
}

export const journeySearchService: JourneySearchService = {
  search: (request) => searchTravelCandidates(request),
};

async function postAgent<T>(
  request: unknown,
  unavailableMessage: string,
  label: string,
  validate: (value: unknown) => value is T,
  fetcher: typeof fetch,
  retryTransientFailure = false,
): Promise<AgentApiResult<T>> {
  const body = JSON.stringify(request);
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Content-Sha256": await sha256Hex(body),
    },
    body,
  };
  let response: Response;
  let retried = false;
  try {
    response = await fetcher("/api/agent", requestInit);
  } catch (error) {
    if (!retryTransientFailure) {
      throw error;
    }
    retried = true;
    response = await fetcher("/api/agent", requestInit);
  }
  if (
    retryTransientFailure &&
    !retried &&
    isTransientStatus(response.status)
  ) {
    response = await fetcher("/api/agent", requestInit);
  }
  if (!response.ok) {
    throw new Error(`${unavailableMessage} (${response.status})。`);
  }
  const requestId = response.headers.get("x-transitforge-request-id") ?? undefined;
  const value: unknown = await response.json();
  if (!validate(value)) {
    throw new Error(`${label}APIから不正な応答を受信しました。`);
  }
  return {
    body: value,
    metadata: requestId ? { requestId } : {},
  };
}

async function postAgentBody<T>(
  request: unknown,
  unavailableMessage: string,
  label: string,
  validate: (value: unknown) => value is T,
  fetcher: typeof fetch,
  retryTransientFailure = false,
): Promise<T> {
  return (await postAgent(
    request,
    unavailableMessage,
    label,
    validate,
    fetcher,
    retryTransientFailure,
  )).body;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isAgentTraceStoredResponse(value: unknown): value is AgentTraceStoredResponse {
  return typeof value === "object" &&
    value !== null &&
    "traceId" in value &&
    typeof value.traceId === "string" &&
    "eventCount" in value &&
    typeof value.eventCount === "number" &&
    Number.isInteger(value.eventCount) &&
    value.eventCount >= 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
