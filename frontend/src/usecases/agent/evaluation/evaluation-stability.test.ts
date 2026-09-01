import { describe, expect, it } from "vitest";

import type { AgentEvaluationReport } from "./evaluation-contract";
import {
  renderAgentEvaluationStabilityMarkdown,
  summarizeAgentEvaluationStability,
} from "./evaluation-stability";

describe("summarizeAgentEvaluationStability", () => {
  it("caseごとの再現率と全試行成功を分けて集約する", () => {
    const summary = summarizeAgentEvaluationStability([
      report([true, true]),
      report([true, false]),
      report([true, true]),
    ]);

    expect(summary).toMatchObject({
      repetitions: 3,
      passedAttemptCount: 2,
      attemptPassRate: 2 / 3,
      stableCaseCount: 1,
      cases: [
        { id: "a", passedAttemptCount: 3, passRate: 1, stable: true },
        { id: "b", passedAttemptCount: 2, passRate: 2 / 3, stable: false },
      ],
    });
    expect(renderAgentEvaluationStabilityMarkdown(summary)).toContain("| b | 2/3 | 66.7% | NO |");
  });

  it("異なるcase集合を誤って集約しない", () => {
    expect(() => summarizeAgentEvaluationStability([
      report([true]),
      { ...report([true]), cases: [{ ...report([true]).cases[0]!, id: "different" }] },
    ])).toThrow("caseが一致しません");
  });
});

function report(passed: boolean[]): AgentEvaluationReport {
  const cases = passed.map((value, index) => ({
    id: String.fromCharCode(97 + index),
    name: `case-${index}`,
    passed: value,
    metrics: {
      toolSelectionAccuracy: value ? 1 : 0,
      constraintSatisfaction: 1,
      groundedClaimRate: null,
      unsupportedClaimRate: null,
      taskCompletion: 1,
      viewerActionValidity: 1,
    },
    failures: value ? [] : ["failed"],
  }));
  return {
    schemaVersion: "agent-eval-report-v2",
    datasetSchemaVersion: "agent-eval-dataset-v1",
    caseCount: cases.length,
    passedCaseCount: cases.filter(({ passed: value }) => value).length,
    metrics: {
      toolSelectionAccuracy: 1,
      constraintSatisfaction: 1,
      groundedClaimRate: null,
      unsupportedClaimRate: null,
      taskCompletion: 1,
      viewerActionValidity: 1,
    },
    categories: [],
    cases,
  };
}
