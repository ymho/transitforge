import type { AgentEvaluationReport } from "./evaluation-contract";
import type { AgentTrace } from "../agent-trace";

export interface AgentModelRoutingRun {
  schemaVersion: "agent-model-routing-run-v1";
  strategy: string;
  datasetSchemaVersion: string;
  caseCount: number;
  /** 省略された旧artifactは1として扱う。runtime値は全反復の合計。 */
  repetitions?: number;
  passedCaseCount: number;
  quality: AgentEvaluationReport["metrics"];
  runtime: {
    totalLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
    toolCalls: number;
  };
}

export interface AgentModelRoutingComparison {
  schemaVersion: "agent-model-routing-comparison-v1";
  sameBenchmark: boolean;
  qualityMaintained: boolean;
  costImproved: boolean;
  productionRoutingRecommended: boolean;
  changes: {
    latency: number | null;
    totalTokens: number | null;
    modelCalls: number | null;
    toolCalls: number | null;
  };
  reasons: string[];
}

export function createAgentModelRoutingRun(
  strategy: string,
  report: AgentEvaluationReport,
  traces: AgentTrace[],
): AgentModelRoutingRun {
  if (!strategy.trim() || report.caseCount < 1 || traces.length < report.caseCount ||
    traces.length % report.caseCount !== 0) {
    throw new Error("model routing runには同じBenchmarkを同じ回数反復したcaseごとのTraceが必要です");
  }
  const repetitions = traces.length / report.caseCount;
  const modelEvents = traces.flatMap(({ events }) =>
    events.filter((event) => event.type === "model_completed"));
  const toolEvents = traces.flatMap(({ events }) =>
    events.filter((event) => event.type === "tool_called"));
  return {
    schemaVersion: "agent-model-routing-run-v1",
    strategy,
    datasetSchemaVersion: report.datasetSchemaVersion,
    caseCount: report.caseCount,
    repetitions,
    passedCaseCount: report.passedCaseCount,
    quality: report.metrics,
    runtime: {
      totalLatencyMs: modelEvents.reduce((sum, event) =>
        sum + (event.type === "model_completed" ? event.latencyMs ?? 0 : 0), 0),
      inputTokens: modelEvents.reduce((sum, event) =>
        sum + (event.type === "model_completed" ? event.inputTokens ?? 0 : 0), 0),
      outputTokens: modelEvents.reduce((sum, event) =>
        sum + (event.type === "model_completed" ? event.outputTokens ?? 0 : 0), 0),
      modelCalls: modelEvents.length,
      toolCalls: toolEvents.length,
    },
  };
}

export function compareAgentModelRouting(
  baseline: AgentModelRoutingRun,
  candidate: AgentModelRoutingRun,
): AgentModelRoutingComparison {
  const sameBenchmark = baseline.datasetSchemaVersion === candidate.datasetSchemaVersion &&
    baseline.caseCount === candidate.caseCount &&
    (baseline.repetitions ?? 1) === (candidate.repetitions ?? 1);
  const qualityMaintained = sameBenchmark &&
    candidate.passedCaseCount >= baseline.passedCaseCount &&
    candidate.quality.toolSelectionAccuracy >= baseline.quality.toolSelectionAccuracy &&
    candidate.quality.constraintSatisfaction >= baseline.quality.constraintSatisfaction &&
    nullableAtLeast(candidate.quality.groundedClaimRate, baseline.quality.groundedClaimRate) &&
    nullableAtMost(candidate.quality.unsupportedClaimRate, baseline.quality.unsupportedClaimRate) &&
    candidate.quality.taskCompletion >= baseline.quality.taskCompletion &&
    candidate.quality.viewerActionValidity >= baseline.quality.viewerActionValidity;
  const changes = {
    latency: ratioChange(candidate.runtime.totalLatencyMs, baseline.runtime.totalLatencyMs),
    totalTokens: ratioChange(
      candidate.runtime.inputTokens + candidate.runtime.outputTokens,
      baseline.runtime.inputTokens + baseline.runtime.outputTokens,
    ),
    modelCalls: ratioChange(candidate.runtime.modelCalls, baseline.runtime.modelCalls),
    toolCalls: ratioChange(candidate.runtime.toolCalls, baseline.runtime.toolCalls),
  };
  const measurableCostGain = (changes.latency !== null && changes.latency <= -0.1) ||
    (changes.totalTokens !== null && changes.totalTokens <= -0.1);
  const costImproved = measurableCostGain &&
    (changes.modelCalls === null || changes.modelCalls <= 0) &&
    (changes.toolCalls === null || changes.toolCalls <= 0);
  const reasons: string[] = [];
  if (!sameBenchmark) reasons.push("同じBenchmarkではない");
  if (!qualityMaintained) reasons.push("Agent品質を維持できていない");
  if (!costImproved) reasons.push("latencyまたはtokenの明確な改善を確認できない");
  return {
    schemaVersion: "agent-model-routing-comparison-v1",
    sameBenchmark,
    qualityMaintained,
    costImproved,
    productionRoutingRecommended: sameBenchmark && qualityMaintained && costImproved,
    changes,
    reasons,
  };
}

export function parseAgentModelRoutingRun(value: unknown): AgentModelRoutingRun {
  if (!isRecord(value) || value.schemaVersion !== "agent-model-routing-run-v1" ||
    typeof value.strategy !== "string" || !value.strategy.trim() ||
    typeof value.datasetSchemaVersion !== "string" ||
    !integer(value.caseCount) || !integer(value.passedCaseCount) ||
    (value.repetitions !== undefined && !positiveInteger(value.repetitions)) ||
    value.passedCaseCount > value.caseCount || !quality(value.quality) ||
    !runtime(value.runtime)) {
    throw new Error("model routing runの形式が不正です");
  }
  return value as unknown as AgentModelRoutingRun;
}

function quality(value: unknown): value is AgentEvaluationReport["metrics"] {
  return isRecord(value) &&
    unit(value.toolSelectionAccuracy) && unit(value.constraintSatisfaction) &&
    nullableUnit(value.groundedClaimRate) && nullableUnit(value.unsupportedClaimRate) &&
    unit(value.taskCompletion) && unit(value.viewerActionValidity);
}

function runtime(value: unknown): value is AgentModelRoutingRun["runtime"] {
  return isRecord(value) && nonNegative(value.totalLatencyMs) &&
    integer(value.inputTokens) && integer(value.outputTokens) &&
    integer(value.modelCalls) && integer(value.toolCalls);
}

function ratioChange(candidate: number, baseline: number): number | null {
  return baseline === 0 ? null : candidate / baseline - 1;
}

function nullableAtLeast(value: number | null, baseline: number | null): boolean {
  return baseline === null ? value === null : value !== null && value >= baseline;
}

function nullableAtMost(value: number | null, baseline: number | null): boolean {
  return baseline === null ? value === null : value !== null && value <= baseline;
}

function unit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nullableUnit(value: unknown): value is number | null {
  return value === null || unit(value);
}

function integer(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
