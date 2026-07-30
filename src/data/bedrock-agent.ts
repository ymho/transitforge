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
