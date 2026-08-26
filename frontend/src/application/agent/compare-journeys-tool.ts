import type { JourneySearchResponse } from "@raiquora/journey/journey-search-service";
import {
  compareJourneySearchResult,
  type JourneyComparison,
} from "@raiquora/journey/journey-comparison-service";
import {
  failedAgentToolResult,
  invalidAgentToolInput,
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentExecutionContext,
  type AgentTool,
  type AgentToolInputResult,
} from "./tool-contract";

export const maximumComparedJourneys = 3;
export const maximumJourneyComparisonPayloadBytes = 48 * 1_024;

export interface CompareJourneysInput {
  searchResultId: string;
  journeyIndexes?: number[];
}

export interface VerifiedJourneySearchResultSource {
  resolve(
    executionId: string,
    searchResultId: string,
  ): Promise<JourneySearchResponse | undefined>;
}

export function createCompareJourneysTool(
  source: VerifiedJourneySearchResultSource,
): AgentTool<CompareJourneysInput, JourneyComparison> {
  return {
    name: "compare_journeys",
    description: "同じタスク内で検索済みの鉄道経路を時刻 乗換 遅延 制約で比較します",
    inputSchema: {
      type: "object",
      properties: {
        searchResultId: { type: "string", maxLength: 160 },
        journeyIndexes: {
          type: "array",
          maxItems: maximumComparedJourneys,
          items: { type: "integer", minimum: 0 },
        },
      },
      required: ["searchResultId"],
      additionalProperties: false,
    },
    parseInput: parseCompareJourneysInput,
    execute: (input, context) => executeComparison(source, input, context),
  };
}

async function executeComparison(
  source: VerifiedJourneySearchResultSource,
  input: CompareJourneysInput,
  context: AgentExecutionContext,
) {
  try {
    const searchResult = await source.resolve(
      context.executionId,
      input.searchResultId,
    );
    if (!searchResult) {
      return failedAgentToolResult({
        code: "not_found",
        message: "同じタスク内に検証済みの経路検索結果がありません",
        retryable: false,
      });
    }
    const journeyIndexes = input.journeyIndexes ?? searchResult.journeys
      .slice(0, maximumComparedJourneys)
      .map((_, index) => index);
    const output = compareJourneySearchResult(searchResult, { journeyIndexes });
    if (payloadBytes(output) > maximumJourneyComparisonPayloadBytes) {
      return failedAgentToolResult({
        code: "execution_failed",
        message: "経路比較結果がToolの上限を超えました",
        retryable: false,
      });
    }
    return successfulAgentToolResult(output);
  } catch (error) {
    if (error instanceof RangeError) {
      return failedAgentToolResult({
        code: "invalid_input",
        message: error.message,
        retryable: false,
      });
    }
    return failedAgentToolResult({
      code: "execution_failed",
      message: "経路を比較できませんでした",
      retryable: true,
    });
  }
}

function parseCompareJourneysInput(
  value: unknown,
): AgentToolInputResult<CompareJourneysInput> {
  if (!isRecord(value)) {
    return invalidAgentToolInput("経路比較条件はオブジェクトで指定してください");
  }
  if (Object.keys(value).some((field) =>
    field !== "searchResultId" && field !== "journeyIndexes")) {
    return invalidAgentToolInput("未対応の経路比較条件が含まれています");
  }
  if (!isBoundedText(value.searchResultId)) {
    return invalidAgentToolInput("searchResultIdを指定してください");
  }
  if (
    value.journeyIndexes !== undefined &&
    (!Array.isArray(value.journeyIndexes) ||
      value.journeyIndexes.length < 1 ||
      value.journeyIndexes.length > maximumComparedJourneys ||
      !value.journeyIndexes.every((index) =>
        typeof index === "number" && Number.isInteger(index) && index >= 0) ||
      new Set(value.journeyIndexes).size !== value.journeyIndexes.length)
  ) {
    return invalidAgentToolInput(
      `journeyIndexesは重複なしで${maximumComparedJourneys}件まで指定してください`,
    );
  }
  return validAgentToolInput({
    searchResultId: value.searchResultId,
    ...(value.journeyIndexes === undefined
      ? {}
      : { journeyIndexes: value.journeyIndexes as number[] }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
