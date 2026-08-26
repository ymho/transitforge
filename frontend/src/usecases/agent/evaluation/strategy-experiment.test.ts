import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseAgentEvaluationDataset } from "./evaluation-dataset";
import {
  evaluateAgentStrategyExperiment,
  parseAgentStrategyExperiment,
} from "./strategy-experiment";
import { renderAgentStrategyExperimentMarkdown } from "./strategy-experiment-report";

const fixtures = fileURLToPath(new URL("../../../../../tests/fixtures/", import.meta.url));

describe("Re-plan / Reflection experiment", () => {
  it("reproduces the quality latency and token comparison", () => {
    const dataset = parseAgentEvaluationDataset(readJson("agent-eval-cases.json"));
    const experiment = parseAgentStrategyExperiment(
      readJson("agent-strategy-experiment.json"),
    );

    const report = evaluateAgentStrategyExperiment(dataset, experiment);

    expect(report.measurementBasis).toContain("決定論的な相対コスト");
    expect(report.strategies.map((strategy) => ({
      id: strategy.id,
      passRate: strategy.qualityPassRate,
      latency: strategy.averageLatencyMs,
      tokens: strategy.averageTokens,
    }))).toEqual([
      { id: "single-pass", passRate: 0.5, latency: 80, tokens: 250 },
      { id: "result-driven-replan", passRate: 1, latency: 160, tokens: 500 },
      { id: "always-on-reflection", passRate: 1, latency: 240, tokens: 750 },
    ]);
    expect(report.decision).toMatchObject({
      resultDrivenReplan: "adopt",
      alwaysOnReflection: "reject",
    });
    const markdown = renderAgentStrategyExperimentMarkdown(report);
    expect(markdown).toContain("| single-pass | 4/8 | 50.0% | 80.0ms |");
    expect(markdown).toContain("Result-driven re-plan: ADOPT");
    expect(markdown).toContain("Always-on reflection: REJECT");
  });

  it("rejects missing strategies cases and measurements", () => {
    const dataset = parseAgentEvaluationDataset(readJson("agent-eval-cases.json"));
    const raw = readJson("agent-strategy-experiment.json") as Record<string, unknown>;
    const missingStrategy = structuredClone(raw) as {
      strategies: unknown[];
    };
    missingStrategy.strategies.pop();
    expect(() => parseAgentStrategyExperiment(missingStrategy))
      .toThrow("比較戦略が不足しています");

    const experiment = parseAgentStrategyExperiment(raw);
    experiment.benchmarkCaseIds[0] = "unknown-case";
    expect(() => evaluateAgentStrategyExperiment(dataset, experiment))
      .toThrow("Benchmark caseがdatasetにありません: unknown-case");

    const invalidMeasurement = structuredClone(raw) as {
      strategies: Array<{ measurement: { totalLatencyMs: number } }>;
    };
    invalidMeasurement.strategies[0].measurement.totalLatencyMs = -1;
    expect(() => parseAgentStrategyExperiment(invalidMeasurement))
      .toThrow("Agent strategyの形式が不正です");
  });
});

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtures}${name}`, "utf8"));
}
