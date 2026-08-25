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
} from "./bedrock-agent-contract";
import {
  isBedrockAgentResponse,
  isAccommodationSearchResponse,
  isDailyCongestionAnalysisResponse,
  isDailyCongestionPeakResponse,
  isRepresentativeTimetableSearchResponse,
  isTrainDelayAnalysisResponse,
  isTravelCandidateSearchResponse,
} from "./bedrock-agent-validation";
import type {
  JourneySearchRequest,
  JourneySearchService,
} from "../domain/journey-search-service";

export type * from "./bedrock-agent-contract";

export interface AgentResponseMetadata {
  requestId?: string;
}

export interface AgentApiResult<T> {
  body: T;
  metadata: AgentResponseMetadata;
}

export async function submitConversationFeedback(
  feedback: { rating: "good" | "bad"; conversation: Array<{ role: "user" | "assistant"; text: string }>; requestIds: string[] },
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

export async function invokeBedrockAgent(
  messages: BedrockAgentMessage[],
  fetcher: typeof fetch = fetch,
): Promise<AgentApiResult<BedrockAgentResponse>> {
  return postAgent({ messages }, "AI案内APIを利用できません", "AI案内", isBedrockAgentResponse, fetcher, true);
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
  return postAgentBody(
    { operation: "journey_search", maxTransfers: 3, ...request },
    "旅行候補を検索できません",
    "旅行候補",
    isTravelCandidateSearchResponse,
    fetcher,
    true,
  );
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

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
