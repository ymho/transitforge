import type {
  JourneySearchRequest,
  JourneySearchResponse,
  JourneySearchService,
} from "../../domain/journey-search-service";
import {
  failedAgentToolResult,
  invalidAgentToolInput,
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentTool,
  type AgentToolInputResult,
} from "./tool-contract";

export const maximumJourneyToolResults = 3;
export const maximumJourneyToolPayloadBytes = 64 * 1_024;

export interface VerifiedJourneySearchResultWriter {
  save(executionId: string, result: JourneySearchResponse): string;
}

export type JourneySearchToolOutput = JourneySearchResponse & {
  searchResultId?: string;
};

const transferPaces = new Set(["hurried", "standard", "relaxed"]);
const rankingPreferences = new Set([
  "balanced",
  "earliest-arrival",
  "latest-departure",
  "fewest-transfers",
]);
const constraintFields = [
  "excludedServiceTypes",
  "excludedTrainNames",
  "excludedTrainNumbers",
  "excludedServiceUids",
  "requiredServiceTypes",
  "requiredTrainNames",
  "requiredTrainNumbers",
  "allowedServiceTypes",
] as const;
const allowedInputFields = new Set([
  "serviceDate",
  "originStation",
  "destinationStation",
  "departureTimeMinutes",
  "limit",
  "maxTransfers",
  "transferPace",
  "rankingPreference",
  ...constraintFields,
]);

export function createSearchJourneysTool(
  service: JourneySearchService,
  verifiedResults?: VerifiedJourneySearchResultWriter,
): AgentTool<JourneySearchRequest, JourneySearchToolOutput> {
  return {
    name: "search_journeys",
    description: "自前の時刻表と当日の運行情報を使って鉄道経路を検索します",
    inputSchema: {
      type: "object",
      properties: {
        serviceDate: { type: "string", description: "4時切替の業務日付 YYYY-MM-DD" },
        originStation: { type: "string" },
        destinationStation: { type: "string" },
        departureTimeMinutes: { type: "number", minimum: 0, maximum: 2_880 },
        limit: { type: "integer", minimum: 1, maximum: maximumJourneyToolResults },
        maxTransfers: { type: "integer", minimum: 0, maximum: 3 },
        transferPace: { type: "string", enum: [...transferPaces] },
        rankingPreference: { type: "string", enum: [...rankingPreferences] },
        ...Object.fromEntries(constraintFields.map((field) => [field, {
          type: "array",
          maxItems: 8,
          items: { type: "string", maxLength: 160 },
        }])),
      },
      required: [
        "serviceDate",
        "originStation",
        "destinationStation",
        "departureTimeMinutes",
      ],
      additionalProperties: false,
    },
    parseInput: parseJourneySearchInput,
    execute: async (input, context) => {
      try {
        const limit = input.limit ?? maximumJourneyToolResults;
        const response = await service.search({
          ...input,
          limit,
          maxTransfers: input.maxTransfers ?? 3,
        });
        const bounded = {
          ...response,
          matches: response.matches.slice(0, limit),
          journeys: response.journeys.slice(0, limit),
        };
        const projectedOutput = verifiedResults === undefined
          ? bounded
          : { ...bounded, searchResultId: "journey-search-4" };
        if (payloadBytes(projectedOutput) > maximumJourneyToolPayloadBytes) {
          return failedAgentToolResult({
            code: "execution_failed",
            message: "経路検索結果がToolの上限を超えました",
            retryable: false,
          });
        }
        const output: JourneySearchToolOutput = verifiedResults === undefined
          ? bounded
          : {
              ...bounded,
              searchResultId: verifiedResults.save(context.executionId, bounded),
            };
        return successfulAgentToolResult(output);
      } catch {
        return failedAgentToolResult({
          code: "execution_failed",
          message: "経路検索を実行できませんでした",
          retryable: true,
        });
      }
    },
  };
}

function parseJourneySearchInput(
  value: unknown,
): AgentToolInputResult<JourneySearchRequest> {
  if (!isRecord(value)) {
    return invalidAgentToolInput("経路検索条件はオブジェクトで指定してください");
  }
  if (Object.keys(value).some((field) => !allowedInputFields.has(field))) {
    return invalidAgentToolInput("未対応の経路検索条件が含まれています");
  }
  if (!isServiceDate(value.serviceDate)) {
    return invalidAgentToolInput("serviceDateはYYYY-MM-DDで指定してください");
  }
  if (!isBoundedText(value.originStation) || !isBoundedText(value.destinationStation)) {
    return invalidAgentToolInput("出発駅と到着駅を指定してください");
  }
  if (
    typeof value.departureTimeMinutes !== "number" ||
    !Number.isFinite(value.departureTimeMinutes) ||
    value.departureTimeMinutes < 0 ||
    value.departureTimeMinutes > 2_880
  ) {
    return invalidAgentToolInput("departureTimeMinutesが範囲外です");
  }
  if (!isOptionalInteger(value.limit, 1, maximumJourneyToolResults)) {
    return invalidAgentToolInput(`limitは1から${maximumJourneyToolResults}で指定してください`);
  }
  if (!isOptionalInteger(value.maxTransfers, 0, 3)) {
    return invalidAgentToolInput("maxTransfersは0から3で指定してください");
  }
  if (value.transferPace !== undefined && !transferPaces.has(String(value.transferPace))) {
    return invalidAgentToolInput("transferPaceが不正です");
  }
  if (
    value.rankingPreference !== undefined &&
    !rankingPreferences.has(String(value.rankingPreference))
  ) {
    return invalidAgentToolInput("rankingPreferenceが不正です");
  }
  for (const field of constraintFields) {
    if (!isConstraintList(value[field])) {
      return invalidAgentToolInput(`${field}が不正です`);
    }
  }
  const requirementCount = [
    value.requiredServiceTypes,
    value.requiredTrainNames,
    value.requiredTrainNumbers,
  ].reduce<number>(
    (count, items) => count + (Array.isArray(items) ? items.length : 0),
    0,
  );
  if (requirementCount > 4) {
    return invalidAgentToolInput("利用したい列車条件は4件までです");
  }

  return validAgentToolInput(value as unknown as JourneySearchRequest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isServiceDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

function isOptionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return value === undefined || (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isConstraintList(value: unknown): boolean {
  return value === undefined || (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every(isBoundedText)
  );
}

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
