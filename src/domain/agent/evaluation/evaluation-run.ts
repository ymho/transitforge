import { evaluateAgentDataset } from "./agent-evaluator";
import type {
  AgentEvaluationDataset,
  AgentEvaluationMetricName,
  AgentEvaluationObservationSet,
  AgentEvaluationProfile,
  AgentEvaluationRunReport,
  AgentEvaluationThresholds,
} from "./evaluation-contract";

export const defaultAgentEvaluationThresholds: AgentEvaluationThresholds = {
  toolSelectionAccuracy: { operator: "minimum", value: 1 },
  constraintSatisfaction: { operator: "minimum", value: 1 },
  groundedClaimRate: { operator: "minimum", value: 1 },
  unsupportedClaimRate: { operator: "maximum", value: 0 },
  taskCompletion: { operator: "minimum", value: 1 },
  viewerActionValidity: { operator: "minimum", value: 1 },
};

export function runAgentEvaluationProfile(
  dataset: AgentEvaluationDataset,
  observations: AgentEvaluationObservationSet,
  profile: AgentEvaluationProfile,
  thresholds: AgentEvaluationThresholds = defaultAgentEvaluationThresholds,
): AgentEvaluationRunReport {
  const selectedTag = profile === "smoke" ? "smoke" : undefined;
  const cases = selectedTag
    ? dataset.cases.filter(({ tags }) => tags.includes(selectedTag))
    : dataset.cases;
  if (cases.length === 0) throw new Error(`Agent Eval ${profile}のcaseがありません`);
  const caseIds = new Set(cases.map(({ id }) => id));
  const selectedDataset = { ...dataset, cases };
  const selectedObservations = {
    ...observations,
    observations: observations.observations.filter(({ caseId }) => caseIds.has(caseId)),
  };
  const evaluation = evaluateAgentDataset(selectedDataset, selectedObservations);
  const thresholdFailures = Object.entries(thresholds).flatMap(([name, threshold]) => {
    const metricName = name as AgentEvaluationMetricName;
    const actual = evaluation.metrics[metricName];
    if (actual === null) return [`${metricName}: 値を算出できません`];
    const passed = threshold.operator === "minimum"
      ? actual >= threshold.value
      : actual <= threshold.value;
    return passed
      ? []
      : [`${metricName}: ${actual} が ${threshold.operator} ${threshold.value} を満たしません`];
  });
  return {
    ...evaluation,
    profile,
    ...(selectedTag ? { selectedTag } : {}),
    thresholds: structuredClone(thresholds),
    passed: evaluation.passedCaseCount === evaluation.caseCount &&
      thresholdFailures.length === 0,
    thresholdFailures,
  };
}

export function selectAgentEvaluationCase(
  dataset: AgentEvaluationDataset,
  observations: AgentEvaluationObservationSet,
  caseId: string,
): {
  dataset: AgentEvaluationDataset;
  observations: AgentEvaluationObservationSet;
} {
  const selected = dataset.cases.find(({ id }) => id === caseId);
  if (!selected) throw new Error(`Agent Eval caseが見つかりません: ${caseId}`);
  return {
    dataset: { ...dataset, cases: [selected] },
    observations: {
      ...observations,
      observations: observations.observations.filter((item) => item.caseId === caseId),
    },
  };
}
