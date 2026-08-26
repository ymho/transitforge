import type {
  DailyCongestionAnalysisResponse,
  TrainDelayAnalysisResponse,
} from "@raiquora/operation/analysis";
import type { Train } from "@raiquora/train/train";
import {
  congestionAnalysisForAgent,
  type CongestionAnalysisForAgent,
} from "../../domain/congestion-analysis";
import {
  delayAnalysisForAgent,
  type DelayAnalysisForAgent,
} from "../../domain/delay-analysis";
import {
  failedAgentToolResult,
  invalidAgentToolInput,
  successfulAgentToolResult,
  validAgentToolInput,
  type AgentTool,
  type AgentToolInputResult,
} from "./tool-contract";

export const maximumOperationalAnalysisPayloadBytes = 48 * 1_024;

export interface OperationalAnalysisInput {
  serviceDate: string;
}

export interface OperationalAnalysisSourceMetadata {
  source: "operating-day-summary";
  aggregation: "deterministic-v1";
  serviceDate: string;
  sampleCount: number;
  observationStart: string | null;
  observationEnd: string | null;
  observationStatus: "observed" | "unobserved";
}

export interface DelayAnalysisToolOutput extends DelayAnalysisForAgent {
  sourceMetadata: OperationalAnalysisSourceMetadata;
}

export interface CongestionAnalysisToolOutput extends CongestionAnalysisForAgent {
  sourceMetadata: OperationalAnalysisSourceMetadata;
}

export interface OperationalAnalysisDependencies {
  loadDelayAnalysis(serviceDate: string): Promise<TrainDelayAnalysisResponse>;
  loadCongestionAnalysis(serviceDate: string): Promise<DailyCongestionAnalysisResponse>;
  loadTrains(serviceDate: string): Promise<Train[]>;
  lineNameForTrain(train: Train): string;
}

export function createAnalyzeDelayTool(
  dependencies: OperationalAnalysisDependencies,
): AgentTool<OperationalAnalysisInput, DelayAnalysisToolOutput> {
  return {
    name: "analyze_delay",
    description: "指定した業務日付の観測済み遅延を決定論的な日次集計から分析します",
    inputSchema: analysisInputSchema,
    parseInput: parseOperationalAnalysisInput,
    execute: async ({ serviceDate }) => {
      try {
        const [analysis, trains] = await Promise.all([
          dependencies.loadDelayAnalysis(serviceDate),
          dependencies.loadTrains(serviceDate),
        ]);
        return boundedResult(withSourceMetadata(
          delayAnalysisForAgent(analysis, trains),
        ));
      } catch {
        return failedAgentToolResult({
          code: "execution_failed",
          message: "遅延分析を取得できませんでした",
          retryable: true,
        });
      }
    },
  };
}

export function createAnalyzeCongestionTool(
  dependencies: OperationalAnalysisDependencies,
): AgentTool<OperationalAnalysisInput, CongestionAnalysisToolOutput> {
  return {
    name: "analyze_congestion",
    description: "指定した業務日付の観測済み混雑を決定論的な日次集計から分析します",
    inputSchema: analysisInputSchema,
    parseInput: parseOperationalAnalysisInput,
    execute: async ({ serviceDate }) => {
      try {
        const [analysis, trains] = await Promise.all([
          dependencies.loadCongestionAnalysis(serviceDate),
          dependencies.loadTrains(serviceDate),
        ]);
        return boundedResult(withSourceMetadata(
          congestionAnalysisForAgent(
            analysis,
            trains,
            dependencies.lineNameForTrain,
          ),
        ));
      } catch {
        return failedAgentToolResult({
          code: "execution_failed",
          message: "混雑分析を取得できませんでした",
          retryable: true,
        });
      }
    },
  };
}

const analysisInputSchema = {
  type: "object" as const,
  properties: {
    serviceDate: {
      type: "string",
      description: "4時切替の業務日付 YYYY-MM-DD",
    },
  },
  required: ["serviceDate"],
  additionalProperties: false,
};

function parseOperationalAnalysisInput(
  value: unknown,
): AgentToolInputResult<OperationalAnalysisInput> {
  if (!isRecord(value)) {
    return invalidAgentToolInput("分析条件はオブジェクトで指定してください");
  }
  if (Object.keys(value).some((field) => field !== "serviceDate")) {
    return invalidAgentToolInput("未対応の分析条件が含まれています");
  }
  if (!isServiceDate(value.serviceDate)) {
    return invalidAgentToolInput("serviceDateはYYYY-MM-DDで指定してください");
  }
  return validAgentToolInput({ serviceDate: value.serviceDate });
}

function withSourceMetadata<
  T extends {
    serviceDate: string;
    sampleCount: number;
    observationStart: string | null;
    observationEnd: string | null;
  },
>(analysis: T): T & { sourceMetadata: OperationalAnalysisSourceMetadata } {
  return {
    ...analysis,
    sourceMetadata: {
      source: "operating-day-summary",
      aggregation: "deterministic-v1",
      serviceDate: analysis.serviceDate,
      sampleCount: analysis.sampleCount,
      observationStart: analysis.observationStart,
      observationEnd: analysis.observationEnd,
      observationStatus: analysis.sampleCount === 0 ? "unobserved" : "observed",
    },
  };
}

function boundedResult<T>(output: T) {
  if (payloadBytes(output) > maximumOperationalAnalysisPayloadBytes) {
    return failedAgentToolResult({
      code: "execution_failed",
      message: "運行分析結果がToolの上限を超えました",
      retryable: false,
    });
  }
  return successfulAgentToolResult(output);
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

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
