import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { AgentRuntimeResult } from "../runtime-contract";
import { evaluateAgentDataset, observeAgentRuntimeResult } from "./agent-evaluator";
import {
  parseAgentEvaluationDataset,
  parseAgentEvaluationObservations,
} from "./evaluation-dataset";
import { renderAgentEvaluationMarkdown } from "./evaluation-report";

const fixtures = fileURLToPath(new URL("../../../../tests/fixtures/", import.meta.url));

describe("Agent Evaluation Framework", () => {
  it("evaluates 35 reproducible cases and reuses known journey scenarios", () => {
    const dataset = parseAgentEvaluationDataset(readJson("agent-eval-cases.json"));
    const observations = parseAgentEvaluationObservations(
      readJson("agent-eval-observations.json"),
    );
    const journeyScenarios = readJson("journey-search-scenarios.json") as Array<{ id: string }>;
    const journeyScenarioIds = new Set(journeyScenarios.map(({ id }) => id));

    expect(dataset.cases).toHaveLength(35);
    expect(dataset.cases.every(({ journeyScenarioId }) =>
      journeyScenarioId === undefined || journeyScenarioIds.has(journeyScenarioId))).toBe(true);

    const report = evaluateAgentDataset(dataset, observations);
    expect(report.passedCaseCount).toBe(35);
    expect(report.metrics).toEqual({
      toolSelectionAccuracy: 1,
      constraintSatisfaction: 1,
      groundedClaimRate: 1,
      unsupportedClaimRate: 0,
      taskCompletion: 1,
      viewerActionValidity: 1,
    });
    expect(report.categories.map(({ category }) => category)).toEqual([
      "ambiguous-request",
      "cancellation",
      "delay",
      "constraint",
      "information-gap",
      "multi-tool",
      "viewer-action",
    ]);
    expect(report.categories.every(({ metrics }) =>
      metrics.toolSelectionAccuracy === 1 &&
      metrics.constraintSatisfaction === 1 &&
      (metrics.groundedClaimRate === 1 || metrics.groundedClaimRate === null) &&
      (metrics.unsupportedClaimRate === 0 || metrics.unsupportedClaimRate === null) &&
      metrics.taskCompletion === 1 &&
      metrics.viewerActionValidity === 1)).toBe(true);
    const markdown = renderAgentEvaluationMarkdown(report);
    expect(markdown).toContain("Cases: 35/35 passed");
    expect(markdown).toContain("Tool Selection Accuracy: 100.0%");
    expect(markdown).toContain("| cancellation |");
  });

  it("detects tool constraint claim completion and Viewer regressions objectively", () => {
    const dataset = parseAgentEvaluationDataset(readJson("agent-eval-cases.json"));
    const observations = parseAgentEvaluationObservations(
      readJson("agent-eval-observations.json"),
    );
    observations.observations[0] = {
      caseId: "direct-standard",
      toolSequence: ["search_trains"],
      normalizedConstraints: { maxTransfers: 3 },
      status: "failed",
      claimStatuses: ["unsupported"],
      viewerActions: [{ actionType: "focus_train", status: "rejected" }],
    };

    const report = evaluateAgentDataset(dataset, observations);
    const failed = report.cases[0];
    expect(failed.passed).toBe(false);
    expect(failed.failures).toEqual([
      "Tool選択順が期待と異なる",
      "正規化された制約が不足している",
      "Grounded Claim Rateが下限未満",
      "Unsupported Claim Rateが上限超過",
      "Task完了状態が期待と異なる",
      "Viewer Actionが許可条件を満たさない",
    ]);
  });

  it("rejects schema typos and observations outside the dataset", () => {
    expect(() => parseAgentEvaluationDataset({
      schemaVersion: "agent-eval-dataset-v1",
      cases: [],
      unexpected: true,
    })).toThrow("schemaVersion");

    const dataset = parseAgentEvaluationDataset(readJson("agent-eval-cases.json"));
    const observations = parseAgentEvaluationObservations(
      readJson("agent-eval-observations.json"),
    );
    observations.observations.push({
      caseId: "unknown-case",
      toolSequence: [],
      normalizedConstraints: {},
      status: "completed",
      claimStatuses: [],
      viewerActions: [],
    });
    expect(() => evaluateAgentDataset(dataset, observations)).toThrow("unknown-case");
  });

  it("normalizes a Runtime result from its structured Trace", () => {
    const result = {
      status: "completed",
      claims: [{ groundingStatus: "supported" }],
      viewerActions: [{ actionType: "show_evidence", status: "applied" }],
      trace: {
        events: [
          { type: "intent_normalized", constraints: { value: { maxTransfers: 1 } } },
          { type: "tool_called", toolName: "search_journeys" },
        ],
      },
    } as AgentRuntimeResult;

    expect(observeAgentRuntimeResult("case-1", result)).toEqual({
      caseId: "case-1",
      toolSequence: ["search_journeys"],
      normalizedConstraints: { maxTransfers: 1 },
      status: "completed",
      claimStatuses: ["supported"],
      viewerActions: [{ actionType: "show_evidence", status: "applied" }],
    });
  });
});

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtures}${name}`, "utf8"));
}
