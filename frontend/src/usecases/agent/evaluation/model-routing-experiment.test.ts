import { describe, expect, it } from "vitest";

import {
  compareAgentModelRouting,
  createAgentModelRoutingRun,
  parseAgentModelRoutingRun,
  type AgentModelRoutingRun,
} from "./model-routing-experiment";

const baseline: AgentModelRoutingRun = {
  schemaVersion: "agent-model-routing-run-v1",
  strategy: "single-model",
  datasetSchemaVersion: "agent-eval-dataset-v1",
  caseCount: 42,
  repetitions: 1,
  passedCaseCount: 42,
  quality: {
    toolSelectionAccuracy: 1,
    constraintSatisfaction: 1,
    groundedClaimRate: 1,
    unsupportedClaimRate: 0,
    taskCompletion: 1,
    viewerActionValidity: 1,
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

  it("rejects malformed measurement artifacts", () => {
    expect(parseAgentModelRoutingRun(baseline)).toEqual(baseline);
    expect(() => parseAgentModelRoutingRun({ ...baseline, caseCount: -1 })).toThrow("不正");
  });

  it("aggregates latency tokens and call counts from bounded traces", () => {
    const report = {
      schemaVersion: "agent-eval-report-v2" as const,
      datasetSchemaVersion: "agent-eval-dataset-v1" as const,
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
    });
    expect(createAgentModelRoutingRun("single-model", report, [trace]).repetitions).toBe(1);
  });

  it("aggregates repeated benchmark traces and records the repetition count", () => {
    const report = {
      schemaVersion: "agent-eval-report-v2" as const,
      datasetSchemaVersion: "agent-eval-dataset-v1" as const,
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
});
