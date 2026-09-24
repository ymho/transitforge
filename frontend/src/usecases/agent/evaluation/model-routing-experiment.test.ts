import { describe, expect, it } from "vitest";

import {
  compareAgentModelRouting,
  createAgentModelRoutingRun,
  parseAgentModelRoutingRun,
  type AgentModelRoutingRun,
} from "./model-routing-experiment";

const baseline: AgentModelRoutingRun = {
  schemaVersion: "agent-model-routing-run-v2",
  strategy: "single-model",
  datasetSchemaVersion: "agent-eval-dataset-v6",
  caseCount: 42,
  repetitions: 1,
  passedCaseCount: 42,
  quality: {
    toolSelectionAccuracy: 1,
    constraintSatisfaction: 1,
    groundedClaimRate: 1,
    unsupportedClaimRate: 0,
    taskCompletion: 1,
  },
  runtime: {
    totalLatencyMs: 100_000,
    inputTokens: 50_000,
    outputTokens: 10_000,
    modelCalls: 80,
    toolCalls: 60,
  },
};

describe("Agent model routing experiment", () => {
  it("recommends routing only when the same benchmark keeps quality and improves cost", () => {
    const comparison = compareAgentModelRouting(baseline, {
      ...baseline,
      strategy: "class-routing",
      runtime: { ...baseline.runtime, totalLatencyMs: 80_000, inputTokens: 40_000 },
    });

    expect(comparison.productionRoutingRecommended).toBe(true);
    expect(comparison.changes.latency).toBeCloseTo(-0.2);
  });

  it("does not recommend a cheaper candidate with a quality regression", () => {
    const comparison = compareAgentModelRouting(baseline, {
      ...baseline,
      passedCaseCount: 41,
      runtime: { ...baseline.runtime, totalLatencyMs: 50_000 },
    });

    expect(comparison.productionRoutingRecommended).toBe(false);
    expect(comparison.reasons).toContain("Agent品質を維持できていない");
  });

  it("does not recommend a candidate while every measured case still fails", () => {
    const comparison = compareAgentModelRouting({ ...baseline, passedCaseCount: 0, quality: {
      ...baseline.quality, toolSelectionAccuracy: 0.2, taskCompletion: 0.4,
    } }, { ...baseline, strategy: "decision-upper-tier", passedCaseCount: 0, quality: {
      ...baseline.quality, toolSelectionAccuracy: 0.8, taskCompletion: 0.8,
    } });

    expect(comparison).toMatchObject({
      qualityMaintained: true,
      qualityImproved: true,
      productionRoutingRecommended: false,
    });
    expect(comparison.reasons).toContain("候補モデルが全評価ケースを完遂していない");
  });

  it("recommends a slower upper-tier model when it improves quality without regressing any metric", () => {
    const comparison = compareAgentModelRouting({ ...baseline, passedCaseCount: 41, quality: {
      ...baseline.quality, taskCompletion: 0.98,
    } }, {
      ...baseline,
      strategy: "decision-upper-tier",
      runtime: { ...baseline.runtime, totalLatencyMs: 160_000, inputTokens: 70_000, outputTokens: 14_000 },
    });

    expect(comparison).toMatchObject({
      qualityMaintained: true,
      qualityImproved: true,
      costImproved: false,
      productionRoutingRecommended: true,
    });
  });

  it("does not treat a sub-threshold aggregate fluctuation as a quality improvement", () => {
    const comparison = compareAgentModelRouting({ ...baseline, quality: {
      ...baseline.quality, taskCompletion: 0.999,
    } }, baseline);

    expect(comparison).toMatchObject({ qualityImproved: false, costImproved: false, productionRoutingRecommended: false });
  });

  it("rejects malformed measurement artifacts", () => {
    expect(parseAgentModelRoutingRun(baseline)).toEqual(baseline);
    expect(() => parseAgentModelRoutingRun({ ...baseline, caseCount: -1 })).toThrow("不正");
  });

  it("aggregates latency tokens and call counts from bounded traces", () => {
    const report = {
      schemaVersion: "agent-eval-report-v4" as const,
      datasetSchemaVersion: "agent-eval-dataset-v6" as const,
      caseCount: 1,
      passedCaseCount: 1,
      metrics: baseline.quality,
      categories: [],
      cases: [],
    };
    const trace = {
      executionId: "case-1",
      droppedEventCount: 0,
      events: [
        { type: "model_completed" as const, sequence: 1, occurredAt: "2026-08-30T00:00:00Z", provider: "bedrock", latencyMs: 120, inputTokens: 20, outputTokens: 5 },
        { type: "tool_called" as const, sequence: 2, occurredAt: "2026-08-30T00:00:01Z", toolCallId: "1", toolName: "search_journeys", input: { byteLength: 2, truncated: false, value: {} } },
      ],
    };

    expect(createAgentModelRoutingRun("single-model", report, [trace]).runtime).toEqual({
      totalLatencyMs: 120,
      inputTokens: 20,
      outputTokens: 5,
      modelCalls: 1,
      toolCalls: 1,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      cacheStatuses: { unknown: 1 },
    });
    expect(createAgentModelRoutingRun("single-model", report, [trace]).repetitions).toBe(1);
  });

  it("aggregates repeated benchmark traces and records the repetition count", () => {
    const report = {
      schemaVersion: "agent-eval-report-v4" as const,
      datasetSchemaVersion: "agent-eval-dataset-v6" as const,
      caseCount: 1,
      passedCaseCount: 1,
      metrics: baseline.quality,
      categories: [],
      cases: [],
    };
    const trace = {
      executionId: "case-1",
      droppedEventCount: 0,
      events: [{
        type: "model_completed" as const, sequence: 1,
        occurredAt: "2026-08-30T00:00:00Z", provider: "bedrock",
        latencyMs: 100, inputTokens: 10, outputTokens: 2,
      }],
    };

    const run = createAgentModelRoutingRun("repeated", report, [trace, {
      ...trace, executionId: "case-1-repeat-2",
    }]);

    expect(run.repetitions).toBe(2);
    expect(run.runtime).toMatchObject({ totalLatencyMs: 200, modelCalls: 2 });
  });
  it("blocks production routing when aggregate quality hides failed turns", () => {
    const complete = { totalTurns: 18, completedTurns: 18, completionRate: 1, failureCodes: {} };
    const comparison = compareAgentModelRouting({ ...baseline, reliability: complete }, {
      ...baseline, strategy: "unstable-upper-tier", reliability: { totalTurns: 18, completedTurns: 10, completionRate: 10 / 18,
        failureCodes: { unbound_candidate_source: 5, invalid_response_contract: 3 } },
      quality: { ...baseline.quality, taskCompletion: 1 },
    });
    expect(comparison.productionRoutingRecommended).toBe(false);
    expect(comparison.qualityMaintained).toBe(false);
    expect(comparison.reasons).toContain("候補モデルが全turnを完遂していない");
  });
  it("reports all-turn completion, failure codes and cache usage from traces", () => {
    const report = { schemaVersion: "agent-eval-report-v4" as const, datasetSchemaVersion: "agent-eval-dataset-v6" as const,
      caseCount: 1, passedCaseCount: 0, metrics: baseline.quality, categories: [], cases: [] };
    const trace = { executionId: "case-1", droppedEventCount: 0, events: [
      { type: "model_completed" as const, sequence: 1, occurredAt: "2026-09-24T00:00:00Z", provider: "bedrock", cacheReadInputTokens: 30, cacheWriteInputTokens: 10, cacheStatus: "read" as const },
      { type: "task_completed" as const, sequence: 2, occurredAt: "2026-09-24T00:00:01Z", status: "failed" as const, reason: "unbound_candidate_source" },
    ] };
    const run = createAgentModelRoutingRun("candidate", report, [trace]);
    expect(run.reliability).toEqual({ totalTurns: 1, completedTurns: 0, completionRate: 0,
      failureCodes: { unbound_candidate_source: 1 } });
    expect(run.runtime).toMatchObject({ cacheReadInputTokens: 30, cacheWriteInputTokens: 10, cacheStatuses: { read: 1 } });
  });
});
