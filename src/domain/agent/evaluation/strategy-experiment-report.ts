import type { AgentStrategyExperimentReport } from "./strategy-experiment";

export function renderAgentStrategyExperimentMarkdown(
  report: AgentStrategyExperimentReport,
): string {
  const lines = [
    "# Re-plan / Reflection Experiment",
    "",
    `Hypothesis: ${report.hypothesis}`,
    "",
    `Measurement basis: ${report.measurementBasis}`,
    "",
    `Benchmark cases: ${report.benchmarkCaseIds.join(", ")}`,
    "",
    "| Strategy | Passed | Quality | Latency/case | Model calls/case | Tool calls/case | Tokens/case |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.strategies.map((strategy) =>
      `| ${strategy.id} | ${strategy.quality.passedCaseCount}/${strategy.quality.caseCount} | ` +
      `${percent(strategy.qualityPassRate)} | ${strategy.averageLatencyMs.toFixed(1)}ms | ` +
      `${strategy.averageModelCalls.toFixed(2)} | ${strategy.averageToolCalls.toFixed(2)} | ` +
      `${strategy.averageTokens.toFixed(1)} |`),
    "",
    "## Decision",
    "",
    `- Result-driven re-plan: ${report.decision.resultDrivenReplan.toUpperCase()}`,
    `- Always-on reflection: ${report.decision.alwaysOnReflection.toUpperCase()}`,
    ...report.decision.reasons.map((reason) => `- ${reason}`),
  ];
  return `${lines.join("\n")}\n`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
