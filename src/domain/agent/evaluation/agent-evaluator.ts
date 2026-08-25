import type { AgentRuntimeResult } from "../runtime-contract";
import type {
  AgentEvaluationCase,
  AgentEvaluationCaseResult,
  AgentEvaluationDataset,
  AgentEvaluationObservation,
  AgentEvaluationObservationSet,
  AgentEvaluationReport,
} from "./evaluation-contract";

export function observeAgentRuntimeResult(
  caseId: string,
  result: AgentRuntimeResult,
): AgentEvaluationObservation {
  const normalized = result.trace.events.find((event) => event.type === "intent_normalized");
  const toolSequence = result.trace.events
    .filter((event) => event.type === "tool_called")
    .map((event) => event.type === "tool_called" ? event.toolName : "");
  return {
    caseId,
    toolSequence,
    normalizedConstraints: normalized?.type === "intent_normalized" &&
        isRecord(normalized.constraints.value)
      ? normalized.constraints.value
      : {},
    status: result.status,
    claimStatuses: result.claims.map(({ groundingStatus }) => groundingStatus),
    viewerActions: result.viewerActions.map(({ actionType, status }) => ({
      actionType,
      status,
    })),
  };
}

export function evaluateAgentDataset(
  dataset: AgentEvaluationDataset,
  observationSet: AgentEvaluationObservationSet,
): AgentEvaluationReport {
  const caseIds = new Set(dataset.cases.map(({ id }) => id));
  const unknownCaseId = observationSet.observations.find(({ caseId }) => !caseIds.has(caseId))
    ?.caseId;
  if (unknownCaseId) {
    throw new Error(`datasetに存在しないAgent Eval observationです: ${unknownCaseId}`);
  }
  const byCase = new Map(observationSet.observations.map((item) => [item.caseId, item]));
  const cases = dataset.cases.map((testCase) =>
    evaluateCase(testCase, byCase.get(testCase.id)));
  const claimCounts = observationSet.observations.reduce((counts, observation) => {
    for (const status of observation.claimStatuses) counts[status] += 1;
    return counts;
  }, { supported: 0, unsupported: 0, unknown: 0 });
  const groundedDenominator = claimCounts.supported + claimCounts.unsupported;
  return {
    schemaVersion: "agent-eval-report-v1",
    datasetSchemaVersion: dataset.schemaVersion,
    caseCount: cases.length,
    passedCaseCount: cases.filter(({ passed }) => passed).length,
    metrics: {
      toolSelectionAccuracy: average(cases, "toolSelectionAccuracy"),
      constraintSatisfaction: average(cases, "constraintSatisfaction"),
      groundedClaimRate: groundedDenominator === 0
        ? null
        : claimCounts.supported / groundedDenominator,
      unsupportedClaimRate: groundedDenominator === 0
        ? null
        : claimCounts.unsupported / groundedDenominator,
      taskCompletion: average(cases, "taskCompletion"),
      viewerActionValidity: average(cases, "viewerActionValidity"),
    },
    cases,
  };
}

function evaluateCase(
  testCase: AgentEvaluationCase,
  observation: AgentEvaluationObservation | undefined,
): AgentEvaluationCaseResult {
  if (!observation) {
    return failedMissingObservation(testCase);
  }
  const expected = testCase.expected;
  const toolSelectionAccuracy = equalLists(observation.toolSequence, expected.toolSequence) ? 1 : 0;
  const constraintSatisfaction = matchingConstraintRate(
    observation.normalizedConstraints,
    expected.constraints,
  );
  const supported = observation.claimStatuses.filter((status) => status === "supported").length;
  const unsupported = observation.claimStatuses.filter((status) => status === "unsupported").length;
  const claimDenominator = supported + unsupported;
  const groundedClaimRate = claimDenominator === 0 ? null : supported / claimDenominator;
  const unsupportedClaimRate = claimDenominator === 0 ? null : unsupported / claimDenominator;
  const taskCompletion = observation.status === expected.status ? 1 : 0;
  const viewerActionValidity = validViewerActions(observation, testCase) ? 1 : 0;
  const failures: string[] = [];
  if (!toolSelectionAccuracy) failures.push("Tool選択順が期待と異なる");
  if (constraintSatisfaction < 1) failures.push("正規化された制約が不足している");
  if ((groundedClaimRate ?? 1) < expected.minimumGroundedClaimRate) {
    failures.push("Grounded Claim Rateが下限未満");
  }
  if ((unsupportedClaimRate ?? 0) > expected.maximumUnsupportedClaimRate) {
    failures.push("Unsupported Claim Rateが上限超過");
  }
  if (!taskCompletion) failures.push("Task完了状態が期待と異なる");
  if (!viewerActionValidity) failures.push("Viewer Actionが許可条件を満たさない");
  return {
    id: testCase.id,
    name: testCase.name,
    passed: failures.length === 0,
    metrics: {
      toolSelectionAccuracy,
      constraintSatisfaction,
      groundedClaimRate,
      unsupportedClaimRate,
      taskCompletion,
      viewerActionValidity,
    },
    failures,
  };
}

function validViewerActions(
  observation: AgentEvaluationObservation,
  testCase: AgentEvaluationCase,
): boolean {
  const allowed = new Set(testCase.expected.allowedViewerActions);
  const applied = new Set(observation.viewerActions
    .filter(({ status }) => status === "applied")
    .map(({ actionType }) => actionType));
  return observation.viewerActions.every(({ actionType, status }) =>
    status === "applied" && allowed.has(actionType)) &&
    testCase.expected.requiredViewerActions.every((action) => applied.has(action));
}

function matchingConstraintRate(
  actual: Record<string, unknown>,
  expected: Record<string, string | number | boolean | string[]>,
): number {
  const entries = Object.entries(expected);
  if (entries.length === 0) return 1;
  return entries.filter(([key, value]) => equivalent(actual[key], value)).length / entries.length;
}

function equivalent(actual: unknown, expected: string | number | boolean | string[]): boolean {
  if (!Array.isArray(expected)) return actual === expected;
  return Array.isArray(actual) && equalLists(actual, expected);
}

function equalLists(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function average(
  cases: AgentEvaluationCaseResult[],
  metric: "toolSelectionAccuracy" | "constraintSatisfaction" |
    "taskCompletion" | "viewerActionValidity",
): number {
  return cases.reduce((sum, item) => sum + item.metrics[metric], 0) / cases.length;
}

function failedMissingObservation(testCase: AgentEvaluationCase): AgentEvaluationCaseResult {
  return {
    id: testCase.id,
    name: testCase.name,
    passed: false,
    metrics: {
      toolSelectionAccuracy: 0,
      constraintSatisfaction: 0,
      groundedClaimRate: null,
      unsupportedClaimRate: null,
      taskCompletion: 0,
      viewerActionValidity: 0,
    },
    failures: ["実行結果がありません"],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
