import { evaluateAgentDataset } from "./agent-evaluator";
import {
  agentEvaluationObservationSchemaVersion,
  type AgentEvaluationDataset,
  type AgentEvaluationObservation,
  type AgentEvaluationReport,
} from "./evaluation-contract";
import { parseAgentEvaluationObservations } from "./evaluation-dataset";

export const agentStrategyExperimentSchemaVersion = "agent-strategy-experiment-v1";
export const agentStrategyExperimentReportSchemaVersion =
  "agent-strategy-experiment-report-v1";

export const agentStrategyIds = [
  "single-pass",
  "result-driven-replan",
  "always-on-reflection",
] as const;

export type AgentStrategyId = typeof agentStrategyIds[number];

export interface AgentStrategyMeasurement {
  modelCalls: number;
  toolCalls: number;
  totalLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentStrategyExperimentInput {
  schemaVersion: typeof agentStrategyExperimentSchemaVersion;
  hypothesis: string;
  measurementBasis: string;
  benchmarkCaseIds: string[];
  strategies: Array<{
    id: AgentStrategyId;
    observations: AgentEvaluationObservation[];
    measurement: AgentStrategyMeasurement;
  }>;
}

export interface AgentStrategyExperimentResult {
  id: AgentStrategyId;
  quality: AgentEvaluationReport;
  qualityPassRate: number;
  averageLatencyMs: number;
  averageModelCalls: number;
  averageToolCalls: number;
  averageTokens: number;
}

export interface AgentStrategyExperimentReport {
  schemaVersion: typeof agentStrategyExperimentReportSchemaVersion;
  hypothesis: string;
  measurementBasis: string;
  benchmarkCaseIds: string[];
  strategies: AgentStrategyExperimentResult[];
  decision: {
    resultDrivenReplan: "adopt" | "reject";
    alwaysOnReflection: "adopt" | "reject";
    reasons: string[];
  };
}

export function parseAgentStrategyExperiment(
  value: unknown,
): AgentStrategyExperimentInput {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "schemaVersion", "hypothesis", "measurementBasis", "benchmarkCaseIds", "strategies",
  ]) || value.schemaVersion !== agentStrategyExperimentSchemaVersion ||
    typeof value.hypothesis !== "string" || value.hypothesis.length === 0 ||
    typeof value.measurementBasis !== "string" || value.measurementBasis.length === 0 ||
    !identifierList(value.benchmarkCaseIds) || !Array.isArray(value.strategies)) {
    throw new Error("Agent strategy experimentの形式が不正です");
  }
  const strategies = value.strategies.map((strategy) => parseStrategy(strategy));
  if (strategies.length !== agentStrategyIds.length ||
    agentStrategyIds.some((id) => !strategies.some((strategy) => strategy.id === id))) {
    throw new Error("Agent strategy experimentの比較戦略が不足しています");
  }
  ensureUnique(value.benchmarkCaseIds, "Benchmark case ID");
  ensureUnique(strategies.map(({ id }) => id), "Agent strategy ID");
  return {
    schemaVersion: agentStrategyExperimentSchemaVersion,
    hypothesis: value.hypothesis,
    measurementBasis: value.measurementBasis,
    benchmarkCaseIds: [...value.benchmarkCaseIds],
    strategies,
  };
}

export function evaluateAgentStrategyExperiment(
  dataset: AgentEvaluationDataset,
  experiment: AgentStrategyExperimentInput,
): AgentStrategyExperimentReport {
  const selectedCases = experiment.benchmarkCaseIds.map((id) => {
    const selected = dataset.cases.find((testCase) => testCase.id === id);
    if (!selected) throw new Error(`Benchmark caseがdatasetにありません: ${id}`);
    return selected;
  });
  const selectedDataset = { ...dataset, cases: selectedCases };
  const expectedIds = new Set(experiment.benchmarkCaseIds);
  const strategies = experiment.strategies.map((strategy) => {
    const observedIds = new Set(strategy.observations.map(({ caseId }) => caseId));
    if (observedIds.size !== expectedIds.size ||
      [...expectedIds].some((id) => !observedIds.has(id))) {
      throw new Error(`戦略「${strategy.id}」のobservationが不足しています`);
    }
    const quality = evaluateAgentDataset(selectedDataset, {
      schemaVersion: agentEvaluationObservationSchemaVersion,
      observations: strategy.observations,
    });
    return strategyResult(
      strategy.id,
      quality,
      strategy.measurement,
      selectedCases.length,
    );
  });
  const singlePass = resultFor(strategies, "single-pass");
  const replan = resultFor(strategies, "result-driven-replan");
  const reflection = resultFor(strategies, "always-on-reflection");
  const replanImprovesQuality = replan.qualityPassRate > singlePass.qualityPassRate;
  const reflectionImprovesQuality = reflection.qualityPassRate > replan.qualityPassRate;
  return {
    schemaVersion: agentStrategyExperimentReportSchemaVersion,
    hypothesis: experiment.hypothesis,
    measurementBasis: experiment.measurementBasis,
    benchmarkCaseIds: [...experiment.benchmarkCaseIds],
    strategies,
    decision: {
      resultDrivenReplan: replanImprovesQuality ? "adopt" : "reject",
      alwaysOnReflection: reflectionImprovesQuality ? "adopt" : "reject",
      reasons: [
        replanImprovesQuality
          ? `結果駆動再計画は完了率を${percentPoint(singlePass.qualityPassRate)}から` +
            `${percentPoint(replan.qualityPassRate)}へ改善した`
          : "結果駆動再計画による完了率改善を確認できなかった",
        reflectionImprovesQuality
          ? "常時Reflectionは結果駆動再計画より完了率を改善した"
          : "常時Reflectionは結果駆動再計画より完了率を改善しなかった",
        `常時Reflectionの平均latencyは${reflection.averageLatencyMs.toFixed(1)}ms ` +
          `平均tokenは${reflection.averageTokens.toFixed(1)}で ` +
          `結果駆動再計画の${replan.averageLatencyMs.toFixed(1)}ms ` +
          `${replan.averageTokens.toFixed(1)}tokenを上回った`,
      ],
    },
  };
}

function parseStrategy(value: unknown): AgentStrategyExperimentInput["strategies"][number] {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id", "observations", "measurement",
  ]) || !agentStrategyIds.includes(value.id as AgentStrategyId) ||
    !Array.isArray(value.observations) || !isMeasurement(value.measurement)) {
    throw new Error("Agent strategyの形式が不正です");
  }
  const parsed = parseAgentEvaluationObservations({
    schemaVersion: agentEvaluationObservationSchemaVersion,
    observations: value.observations,
  });
  return {
    id: value.id as AgentStrategyId,
    observations: parsed.observations,
    measurement: { ...value.measurement },
  };
}

function strategyResult(
  id: AgentStrategyId,
  quality: AgentEvaluationReport,
  measurement: AgentStrategyMeasurement,
  caseCount: number,
): AgentStrategyExperimentResult {
  return {
    id,
    quality,
    qualityPassRate: quality.passedCaseCount / quality.caseCount,
    averageLatencyMs: measurement.totalLatencyMs / caseCount,
    averageModelCalls: measurement.modelCalls / caseCount,
    averageToolCalls: measurement.toolCalls / caseCount,
    averageTokens: (measurement.inputTokens + measurement.outputTokens) / caseCount,
  };
}

function resultFor(
  results: AgentStrategyExperimentResult[],
  id: AgentStrategyId,
): AgentStrategyExperimentResult {
  const result = results.find((item) => item.id === id);
  if (!result) throw new Error(`Agent strategyの結果がありません: ${id}`);
  return result;
}

function isMeasurement(value: unknown): value is AgentStrategyMeasurement {
  return isRecord(value) && hasOnlyKeys(value, [
    "modelCalls", "toolCalls", "totalLatencyMs", "inputTokens", "outputTokens",
  ]) && [
    value.modelCalls,
    value.toolCalls,
    value.totalLatencyMs,
    value.inputTokens,
    value.outputTokens,
  ].every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0);
}

function identifierList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 50 &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 200);
}

function ensureUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label}が重複しています`);
}

function percentPoint(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
