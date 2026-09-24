import type { AgentEvaluationReport } from "./evaluation-contract";
import type { AgentTrace } from "@raiquora/agent/agent-trace";

export interface AgentModelRoutingRun {
  schemaVersion: "agent-model-routing-run-v2";
  strategy: string;
  datasetSchemaVersion: string;
  caseCount: number;
  /** 省略された旧artifactは1として扱う。runtime値は全反復の合計。 */
  repetitions?: number;
  passedCaseCount: number;
  quality: AgentEvaluationReport["metrics"];
  reliability?: {
    totalTurns: number;
    completedTurns: number;
    completionRate: number;
    failureCodes: Record<string, number>;
  };
  runtime: {
    totalLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
    toolCalls: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
    cacheStatuses?: Record<string, number>;
  };
}

export interface AgentModelRoutingComparison {
  schemaVersion: "agent-model-routing-comparison-v3";
  sameBenchmark: boolean;
  qualityMaintained: boolean;
  qualityImproved: boolean;
  costImproved: boolean;
  productionRoutingRecommended: boolean;
  reliability: { baseline?: AgentModelRoutingRun["reliability"]; candidate?: AgentModelRoutingRun["reliability"] };
  cache: {
    baseline: Pick<AgentModelRoutingRun["runtime"], "cacheReadInputTokens" | "cacheWriteInputTokens" | "cacheStatuses">;
    candidate: Pick<AgentModelRoutingRun["runtime"], "cacheReadInputTokens" | "cacheWriteInputTokens" | "cacheStatuses">;
  };
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
  const turnEvents = traces.flatMap(({ events }) =>
    events.filter((event) => event.type === "task_completed"));
  const completedTurns = turnEvents.filter((event) => event.type === "task_completed" && event.status === "completed").length;
  const failureCodes = turnEvents.reduce<Record<string, number>>((counts, event) => {
    if (event.type !== "task_completed" || event.status === "completed") return counts;
    const code = event.reason ?? `turn_${event.status}`;
    counts[code] = (counts[code] ?? 0) + 1;
    return counts;
  }, {});
  const cacheStatuses = modelEvents.reduce<Record<string, number>>((counts, event) => {
    if (event.type !== "model_completed") return counts;
    const status = event.cacheStatus ?? "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: "agent-model-routing-run-v2",
    strategy,
    datasetSchemaVersion: report.datasetSchemaVersion,
    caseCount: report.caseCount,
    repetitions,
    passedCaseCount: report.passedCaseCount,
    quality: report.metrics,
    reliability: { totalTurns: turnEvents.length, completedTurns,
      completionRate: turnEvents.length ? completedTurns / turnEvents.length : 0, failureCodes },
    runtime: {
      totalLatencyMs: modelEvents.reduce((sum, event) =>
        sum + (event.type === "model_completed" ? event.latencyMs ?? 0 : 0), 0),
      inputTokens: modelEvents.reduce((sum, event) =>
        sum + (event.type === "model_completed" ? event.inputTokens ?? 0 : 0), 0),
      outputTokens: modelEvents.reduce((sum, event) =>
        sum + (event.type === "model_completed" ? event.outputTokens ?? 0 : 0), 0),
      modelCalls: modelEvents.length,
      toolCalls: toolEvents.length,
      cacheReadInputTokens: modelEvents.reduce((sum, event) => sum + (event.type === "model_completed" ? event.cacheReadInputTokens ?? 0 : 0), 0),
      cacheWriteInputTokens: modelEvents.reduce((sum, event) => sum + (event.type === "model_completed" ? event.cacheWriteInputTokens ?? 0 : 0), 0),
      cacheStatuses,
    },
  };
}

export function compareAgentModelRouting(
  baseline: AgentModelRoutingRun,
  candidate: AgentModelRoutingRun,
): AgentModelRoutingComparison {
  const sameBenchmark = baseline.datasetSchemaVersion === candidate.datasetSchemaVersion &&
    baseline.caseCount === candidate.caseCount &&
    (baseline.repetitions ?? 1) === (candidate.repetitions ?? 1) &&
    (!baseline.reliability || !candidate.reliability || baseline.reliability.totalTurns === candidate.reliability.totalTurns);
  const reliabilityMaintained = !baseline.reliability || !candidate.reliability ||
    candidate.reliability.completionRate >= baseline.reliability.completionRate;
  const qualityMaintained = sameBenchmark &&
    candidate.passedCaseCount >= baseline.passedCaseCount &&
    candidate.quality.toolSelectionAccuracy >= baseline.quality.toolSelectionAccuracy &&
    candidate.quality.constraintSatisfaction >= baseline.quality.constraintSatisfaction &&
    nullableAtLeast(candidate.quality.groundedClaimRate, baseline.quality.groundedClaimRate) &&
    nullableAtMost(candidate.quality.unsupportedClaimRate, baseline.quality.unsupportedClaimRate) &&
    candidate.quality.taskCompletion >= baseline.quality.taskCompletion && reliabilityMaintained;
  const qualityImproved = qualityMaintained && (
    candidate.passedCaseCount > baseline.passedCaseCount ||
    clearIncrease(candidate.quality.toolSelectionAccuracy, baseline.quality.toolSelectionAccuracy) ||
    clearIncrease(candidate.quality.constraintSatisfaction, baseline.quality.constraintSatisfaction) ||
    nullableClearIncrease(candidate.quality.groundedClaimRate, baseline.quality.groundedClaimRate) ||
    nullableClearDecrease(candidate.quality.unsupportedClaimRate, baseline.quality.unsupportedClaimRate) ||
    clearIncrease(candidate.quality.taskCompletion, baseline.quality.taskCompletion) ||
    Boolean(baseline.reliability && candidate.reliability && candidate.reliability.completionRate > baseline.reliability.completionRate)
  );
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
  const allCandidateCasesPassed = candidate.passedCaseCount === candidate.caseCount;
  const allCandidateTurnsCompleted = candidate.reliability === undefined ||
    candidate.reliability.totalTurns > 0 && candidate.reliability.completedTurns === candidate.reliability.totalTurns &&
    Object.keys(candidate.reliability.failureCodes).length === 0;
  const reasons: string[] = [];
  if (!sameBenchmark) reasons.push("同じBenchmarkではない");
  if (!qualityMaintained) reasons.push("Agent品質を維持できていない");
  if (!qualityImproved && !costImproved) reasons.push("品質またはlatency/tokenの明確な改善を確認できない");
  if (!allCandidateCasesPassed) reasons.push("候補モデルが全評価ケースを完遂していない");
  if (!allCandidateTurnsCompleted) reasons.push("候補モデルが全turnを完遂していない");
  return {
    schemaVersion: "agent-model-routing-comparison-v3",
    sameBenchmark,
    qualityMaintained,
    qualityImproved,
    costImproved,
    productionRoutingRecommended: sameBenchmark && allCandidateCasesPassed && allCandidateTurnsCompleted && qualityMaintained && (qualityImproved || costImproved),
    reliability: {
      ...(baseline.reliability ? { baseline: structuredClone(baseline.reliability) } : {}),
      ...(candidate.reliability ? { candidate: structuredClone(candidate.reliability) } : {}),
    },
    cache: {
      baseline: cacheMeasurement(baseline.runtime),
      candidate: cacheMeasurement(candidate.runtime),
    },
    changes,
    reasons,
  };
}

function cacheMeasurement(runtime: AgentModelRoutingRun["runtime"]): AgentModelRoutingComparison["cache"]["baseline"] {
  return {
    ...(runtime.cacheReadInputTokens === undefined ? {} : { cacheReadInputTokens: runtime.cacheReadInputTokens }),
    ...(runtime.cacheWriteInputTokens === undefined ? {} : { cacheWriteInputTokens: runtime.cacheWriteInputTokens }),
    ...(runtime.cacheStatuses === undefined ? {} : { cacheStatuses: structuredClone(runtime.cacheStatuses) }),
  };
}

export function parseAgentModelRoutingRun(value: unknown): AgentModelRoutingRun {
  if (!isRecord(value) || value.schemaVersion !== "agent-model-routing-run-v2" ||
    typeof value.strategy !== "string" || !value.strategy.trim() ||
    typeof value.datasetSchemaVersion !== "string" ||
    !integer(value.caseCount) || !integer(value.passedCaseCount) ||
    (value.repetitions !== undefined && !positiveInteger(value.repetitions)) ||
    value.passedCaseCount > value.caseCount || !quality(value.quality) ||
    (value.reliability !== undefined && !reliability(value.reliability)) || !runtime(value.runtime)) {
    throw new Error("model routing runの形式が不正です");
  }
  return value as unknown as AgentModelRoutingRun;
}

function quality(value: unknown): value is AgentEvaluationReport["metrics"] {
  return isRecord(value) &&
    unit(value.toolSelectionAccuracy) && unit(value.constraintSatisfaction) &&
    nullableUnit(value.groundedClaimRate) && nullableUnit(value.unsupportedClaimRate) &&
    unit(value.taskCompletion);
}

function runtime(value: unknown): value is AgentModelRoutingRun["runtime"] {
  return isRecord(value) && nonNegative(value.totalLatencyMs) &&
    integer(value.inputTokens) && integer(value.outputTokens) &&
    integer(value.modelCalls) && integer(value.toolCalls) &&
    (value.cacheReadInputTokens === undefined || integer(value.cacheReadInputTokens)) &&
    (value.cacheWriteInputTokens === undefined || integer(value.cacheWriteInputTokens)) &&
    (value.cacheStatuses === undefined || countRecord(value.cacheStatuses));
}

function reliability(value: unknown): value is NonNullable<AgentModelRoutingRun["reliability"]> {
  return isRecord(value) && integer(value.totalTurns) && integer(value.completedTurns) && value.completedTurns <= value.totalTurns &&
    unit(value.completionRate) && (value.totalTurns === 0 ? value.completionRate === 0 : value.completionRate === value.completedTurns / value.totalTurns) &&
    countRecord(value.failureCodes);
}

function countRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.entries(value).every(([key, count]) => key.length > 0 && key.length <= 160 && integer(count) && count > 0);
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

function clearIncrease(value: number, baseline: number): boolean {
  return value - baseline >= 0.01;
}

function nullableClearIncrease(value: number | null, baseline: number | null): boolean {
  return baseline !== null && value !== null && clearIncrease(value, baseline);
}

function nullableClearDecrease(value: number | null, baseline: number | null): boolean {
  return baseline !== null && value !== null && baseline - value >= 0.01;
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
