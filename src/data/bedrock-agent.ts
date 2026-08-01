export interface BedrockAgentTextBlock {
  text: string;
}

export interface BedrockAgentToolUseBlock {
  toolUse: {
    toolUseId: string;
    name: string;
    input: Record<string, unknown>;
  };
}

export interface BedrockAgentToolResultBlock {
  toolResult: {
    toolUseId: string;
    status: "success" | "error";
    content: [{ json: unknown }];
  };
}

export type BedrockAgentContentBlock =
  | BedrockAgentTextBlock
  | BedrockAgentToolUseBlock
  | BedrockAgentToolResultBlock;

export interface BedrockAgentMessage {
  role: "assistant" | "user";
  content: BedrockAgentContentBlock[];
}

export interface BedrockAgentResponse {
  message: BedrockAgentMessage;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

export interface DailyCongestionPeak {
  collectedAt: string;
  sourceUpdatedAt: string;
  totalCongestion: number;
  trainCount: number;
  carCount: number;
  topTrains: Array<{
    trainNumber: string;
    totalCongestion: number;
  }>;
}

export interface DailyCongestionPeakResponse {
  serviceDate: string;
  sampleCount: number;
  peak: DailyCongestionPeak | null;
}

export interface TrainCongestionStat {
  trainNumber: string;
  observedSampleCount: number;
  averageCongestion: number;
  dailyAverageContribution: number;
  peakCongestion: number;
  peakCollectedAt: string;
}

export interface HourlyCongestionAnalysis {
  hourJst: number;
  sampleCount: number;
  averageTotalCongestion: number | null;
  peakTotalCongestion: number | null;
  peakCollectedAt: string | null;
  averageTrainCount: number | null;
  topTrain: TrainCongestionStat | null;
}

export interface DailyCongestionAnalysisResponse {
  serviceDate: string;
  sampleCount: number;
  observationStart: string | null;
  observationEnd: string | null;
  peak: DailyCongestionPeak | null;
  hourly: HourlyCongestionAnalysis[];
  trainStats: TrainCongestionStat[];
}

export interface TrainDelaySnapshotAnalysis {
  collectedAt: string;
  sourceCount: number;
  failureCount: number;
  observedTrainCount: number;
  delayedTrainCount: number;
  totalDelayMinutes: number;
  maximumDelayMinutes: number;
  topTrains: Array<{ trainNumber: string; delayMinutes: number }>;
}

export interface HourlyTrainDelayAnalysis {
  hourJst: number;
  sampleCount: number;
  averageDelayedTrainCount: number | null;
  peakDelayedTrainCount: number | null;
  peakTotalDelayMinutes: number | null;
  maximumDelayMinutes: number | null;
  peakCollectedAt: string | null;
}

export interface TrainDelayStat {
  trainNumber: string;
  delayedSampleCount: number;
  averageDelayWhenDelayed: number;
  dailyAverageDelayContribution: number;
  peakDelayMinutes: number;
  peakCollectedAt: string;
}

export interface TrainDelayAnalysisResponse {
  serviceDate: string;
  sampleCount: number;
  observationStart: string | null;
  observationEnd: string | null;
  latest: TrainDelaySnapshotAnalysis | null;
  peak: TrainDelaySnapshotAnalysis | null;
  hourly: HourlyTrainDelayAnalysis[];
  trainStats: TrainDelayStat[];
}

export async function invokeBedrockAgent(
  messages: BedrockAgentMessage[],
  fetcher: typeof fetch = fetch,
): Promise<BedrockAgentResponse> {
  const body = JSON.stringify({ messages });
  const response = await fetcher("/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Content-Sha256": await sha256Hex(body),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`AI案内APIを利用できません (${response.status})。`);
  }

  const value: unknown = await response.json();
  if (!isBedrockAgentResponse(value)) {
    throw new Error("AI案内APIから不正な応答を受信しました。");
  }
  return value;
}

export async function queryDailyCongestionPeak(
  serviceDate: string,
  fetcher: typeof fetch = fetch,
): Promise<DailyCongestionPeakResponse> {
  const body = JSON.stringify({
    operation: "daily_congestion_peak",
    serviceDate,
  });
  const response = await fetcher("/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Content-Sha256": await sha256Hex(body),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`混雑履歴を取得できません (${response.status})。`);
  }

  const value: unknown = await response.json();
  if (!isDailyCongestionPeakResponse(value)) {
    throw new Error("混雑履歴APIから不正な応答を受信しました。");
  }
  return value;
}

export async function queryDailyCongestionAnalysis(
  serviceDate: string,
  fetcher: typeof fetch = fetch,
): Promise<DailyCongestionAnalysisResponse> {
  const body = JSON.stringify({
    operation: "daily_congestion_analysis",
    serviceDate,
  });
  const response = await fetcher("/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Content-Sha256": await sha256Hex(body),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`混雑分析を取得できません (${response.status})。`);
  }

  const value: unknown = await response.json();
  if (!isDailyCongestionAnalysisResponse(value)) {
    throw new Error("混雑分析APIから不正な応答を受信しました。");
  }
  return value;
}

export async function queryTrainDelayAnalysis(
  serviceDate: string,
  fetcher: typeof fetch = fetch,
): Promise<TrainDelayAnalysisResponse> {
  const body = JSON.stringify({
    operation: "train_delay_analysis",
    serviceDate,
  });
  const response = await fetcher("/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Amz-Content-Sha256": await sha256Hex(body),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`列車遅延分析を取得できません (${response.status})。`);
  }
  const value: unknown = await response.json();
  if (!isTrainDelayAnalysisResponse(value)) {
    throw new Error("列車遅延分析APIから不正な応答を受信しました。");
  }
  return value;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isBedrockAgentResponse(value: unknown): value is BedrockAgentResponse {
  return (
    isRecord(value) &&
    (value.stopReason === "end_turn" ||
      value.stopReason === "tool_use" ||
      value.stopReason === "max_tokens") &&
    isMessage(value.message) &&
    value.message.role === "assistant"
  );
}

function isDailyCongestionPeakResponse(
  value: unknown,
): value is DailyCongestionPeakResponse {
  return (
    isRecord(value) &&
    typeof value.serviceDate === "string" &&
    typeof value.sampleCount === "number" &&
    Number.isInteger(value.sampleCount) &&
    value.sampleCount >= 0 &&
    (value.peak === null ||
      (isRecord(value.peak) &&
        typeof value.peak.collectedAt === "string" &&
        typeof value.peak.sourceUpdatedAt === "string" &&
        isNonNegativeNumber(value.peak.totalCongestion) &&
        isNonNegativeNumber(value.peak.trainCount) &&
        isNonNegativeNumber(value.peak.carCount) &&
        Array.isArray(value.peak.topTrains) &&
        value.peak.topTrains.every(
          (train) =>
            isRecord(train) &&
            typeof train.trainNumber === "string" &&
            isNonNegativeNumber(train.totalCongestion),
        )))
  );
}

function isDailyCongestionAnalysisResponse(
  value: unknown,
): value is DailyCongestionAnalysisResponse {
  return (
    isRecord(value) &&
    typeof value.serviceDate === "string" &&
    isNonNegativeInteger(value.sampleCount) &&
    isNullableString(value.observationStart) &&
    isNullableString(value.observationEnd) &&
    (value.peak === null || isDailyCongestionPeak(value.peak)) &&
    Array.isArray(value.hourly) &&
    value.hourly.length === 24 &&
    value.hourly.every(isHourlyCongestionAnalysis) &&
    Array.isArray(value.trainStats) &&
    value.trainStats.every(isTrainCongestionStat)
  );
}

function isDailyCongestionPeak(value: unknown): value is DailyCongestionPeak {
  return (
    isRecord(value) &&
    typeof value.collectedAt === "string" &&
    typeof value.sourceUpdatedAt === "string" &&
    isNonNegativeNumber(value.totalCongestion) &&
    isNonNegativeNumber(value.trainCount) &&
    isNonNegativeNumber(value.carCount) &&
    Array.isArray(value.topTrains) &&
    value.topTrains.every(
      (train) =>
        isRecord(train) &&
        typeof train.trainNumber === "string" &&
        isNonNegativeNumber(train.totalCongestion),
    )
  );
}

function isHourlyCongestionAnalysis(
  value: unknown,
): value is HourlyCongestionAnalysis {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.hourJst) &&
    value.hourJst <= 23 &&
    isNonNegativeInteger(value.sampleCount) &&
    isNullableNonNegativeNumber(value.averageTotalCongestion) &&
    isNullableNonNegativeNumber(value.peakTotalCongestion) &&
    isNullableString(value.peakCollectedAt) &&
    isNullableNonNegativeNumber(value.averageTrainCount) &&
    (value.topTrain === null || isTrainCongestionStat(value.topTrain))
  );
}

function isTrainCongestionStat(value: unknown): value is TrainCongestionStat {
  return (
    isRecord(value) &&
    typeof value.trainNumber === "string" &&
    isNonNegativeInteger(value.observedSampleCount) &&
    isNonNegativeNumber(value.averageCongestion) &&
    isNonNegativeNumber(value.dailyAverageContribution) &&
    isNonNegativeNumber(value.peakCongestion) &&
    typeof value.peakCollectedAt === "string"
  );
}

function isTrainDelayAnalysisResponse(
  value: unknown,
): value is TrainDelayAnalysisResponse {
  return (
    isRecord(value) &&
    typeof value.serviceDate === "string" &&
    isNonNegativeInteger(value.sampleCount) &&
    isNullableString(value.observationStart) &&
    isNullableString(value.observationEnd) &&
    (value.latest === null || isTrainDelaySnapshotAnalysis(value.latest)) &&
    (value.peak === null || isTrainDelaySnapshotAnalysis(value.peak)) &&
    Array.isArray(value.hourly) &&
    value.hourly.length === 24 &&
    value.hourly.every(isHourlyTrainDelayAnalysis) &&
    Array.isArray(value.trainStats) &&
    value.trainStats.every(isTrainDelayStat)
  );
}

function isTrainDelaySnapshotAnalysis(
  value: unknown,
): value is TrainDelaySnapshotAnalysis {
  return (
    isRecord(value) &&
    typeof value.collectedAt === "string" &&
    isNonNegativeInteger(value.sourceCount) &&
    isNonNegativeInteger(value.failureCount) &&
    isNonNegativeInteger(value.observedTrainCount) &&
    isNonNegativeInteger(value.delayedTrainCount) &&
    isNonNegativeNumber(value.totalDelayMinutes) &&
    isNonNegativeNumber(value.maximumDelayMinutes) &&
    Array.isArray(value.topTrains) &&
    value.topTrains.every(
      (train) =>
        isRecord(train) &&
        typeof train.trainNumber === "string" &&
        isNonNegativeNumber(train.delayMinutes),
    )
  );
}

function isHourlyTrainDelayAnalysis(
  value: unknown,
): value is HourlyTrainDelayAnalysis {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.hourJst) &&
    value.hourJst <= 23 &&
    isNonNegativeInteger(value.sampleCount) &&
    isNullableNonNegativeNumber(value.averageDelayedTrainCount) &&
    isNullableNonNegativeNumber(value.peakDelayedTrainCount) &&
    isNullableNonNegativeNumber(value.peakTotalDelayMinutes) &&
    isNullableNonNegativeNumber(value.maximumDelayMinutes) &&
    isNullableString(value.peakCollectedAt)
  );
}

function isTrainDelayStat(value: unknown): value is TrainDelayStat {
  return (
    isRecord(value) &&
    typeof value.trainNumber === "string" &&
    isNonNegativeInteger(value.delayedSampleCount) &&
    isNonNegativeNumber(value.averageDelayWhenDelayed) &&
    isNonNegativeNumber(value.dailyAverageDelayContribution) &&
    isNonNegativeNumber(value.peakDelayMinutes) &&
    typeof value.peakCollectedAt === "string"
  );
}

function isMessage(value: unknown): value is BedrockAgentMessage {
  return (
    isRecord(value) &&
    (value.role === "assistant" || value.role === "user") &&
    Array.isArray(value.content) &&
    value.content.length > 0 &&
    value.content.every(isContentBlock)
  );
}

function isContentBlock(value: unknown): value is BedrockAgentContentBlock {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.text === "string") {
    return true;
  }
  if (isRecord(value.toolUse)) {
    return (
      typeof value.toolUse.toolUseId === "string" &&
      typeof value.toolUse.name === "string" &&
      isRecord(value.toolUse.input)
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
