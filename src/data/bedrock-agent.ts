import type {
  BedrockAgentMessage,
  BedrockAgentResponse,
  DailyCongestionAnalysisResponse,
  DailyCongestionPeakResponse,
  RepresentativeTimetableKind,
  RepresentativeTimetableSearchMode,
  RepresentativeTimetableSearchResponse,
  TrainDelayAnalysisResponse,
} from "./bedrock-agent-contract";
import {
  isBedrockAgentResponse,
  isDailyCongestionAnalysisResponse,
  isDailyCongestionPeakResponse,
  isRepresentativeTimetableSearchResponse,
  isTrainDelayAnalysisResponse,
} from "./bedrock-agent-validation";

export type * from "./bedrock-agent-contract";

export async function invokeBedrockAgent(messages: BedrockAgentMessage[], fetcher: typeof fetch = fetch): Promise<BedrockAgentResponse> {
  return postAgent({ messages }, "AI案内APIを利用できません", "AI案内", isBedrockAgentResponse, fetcher);
}

export async function queryDailyCongestionPeak(serviceDate: string, fetcher: typeof fetch = fetch): Promise<DailyCongestionPeakResponse> {
  return postAgent({ operation: "daily_congestion_peak", serviceDate }, "混雑履歴を取得できません", "混雑履歴", isDailyCongestionPeakResponse, fetcher);
}

export async function queryDailyCongestionAnalysis(serviceDate: string, fetcher: typeof fetch = fetch): Promise<DailyCongestionAnalysisResponse> {
  return postAgent({ operation: "daily_congestion_analysis", serviceDate }, "混雑分析を取得できません", "混雑分析", isDailyCongestionAnalysisResponse, fetcher);
}

export async function queryTrainDelayAnalysis(serviceDate: string, fetcher: typeof fetch = fetch): Promise<TrainDelayAnalysisResponse> {
  return postAgent({ operation: "train_delay_analysis", serviceDate }, "列車遅延分析を取得できません", "列車遅延分析", isTrainDelayAnalysisResponse, fetcher);
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
  return postAgent(
    { operation: "representative_timetable_search", ...request },
    "代表ダイヤを検索できません",
    "代表ダイヤ",
    isRepresentativeTimetableSearchResponse,
    fetcher,
  );
}

async function postAgent<T>(
  request: unknown,
  unavailableMessage: string,
  label: string,
  validate: (value: unknown) => value is T,
  fetcher: typeof fetch,
): Promise<T> {
  const body = JSON.stringify(request);
  const response = await fetcher("/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Content-Sha256": await sha256Hex(body),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`${unavailableMessage} (${response.status})。`);
  }
  const value: unknown = await response.json();
  if (!validate(value)) {
    throw new Error(`${label}APIから不正な応答を受信しました。`);
  }
  return value;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
