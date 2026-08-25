import type { AgentEvaluationReport } from "./evaluation-contract";

export function renderAgentEvaluationMarkdown(report: AgentEvaluationReport): string {
  const lines = [
    "# Agent Evaluation Report",
    "",
    `- Cases: ${report.passedCaseCount}/${report.caseCount} passed`,
    `- Tool Selection Accuracy: ${percent(report.metrics.toolSelectionAccuracy)}`,
    `- Constraint Satisfaction: ${percent(report.metrics.constraintSatisfaction)}`,
    `- Grounded Claim Rate: ${optionalPercent(report.metrics.groundedClaimRate)}`,
    `- Unsupported Claim Rate: ${optionalPercent(report.metrics.unsupportedClaimRate)}`,
    `- Task Completion: ${percent(report.metrics.taskCompletion)}`,
    `- Viewer Action Validity: ${percent(report.metrics.viewerActionValidity)}`,
    "",
    "| Case | Result | Tools | Constraints | Grounded | Unsupported | Completion | Viewer |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of report.cases) {
    lines.push(
      `| ${escapeCell(item.id)} | ${item.passed ? "PASS" : "FAIL"} | ` +
      `${percent(item.metrics.toolSelectionAccuracy)} | ` +
      `${percent(item.metrics.constraintSatisfaction)} | ` +
      `${optionalPercent(item.metrics.groundedClaimRate)} | ` +
      `${optionalPercent(item.metrics.unsupportedClaimRate)} | ` +
      `${percent(item.metrics.taskCompletion)} | ` +
      `${percent(item.metrics.viewerActionValidity)} |`,
    );
    if (item.failures.length > 0) {
      lines.push(`|  | ${escapeCell(item.failures.join(" / "))} |  |  |  |  |  |  |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function optionalPercent(value: number | null): string {
  return value === null ? "N/A" : percent(value);
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
