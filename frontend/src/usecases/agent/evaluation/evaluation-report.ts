import type {
  AgentEvaluationMetricName,
  AgentEvaluationReport,
  AgentEvaluationRunReport,
} from "./evaluation-contract";
import { renderTravelProgressMarkdown } from "./travel-progress-evaluation";

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
    "",
    ...renderCategoryTable(report),
    "",
    ...renderCaseTable(report),
  ];
  return `${lines.join("\n")}\n${report.travelProgress ? renderTravelProgressMarkdown(report.travelProgress) : ""}`;
}

export function renderAgentEvaluationRunMarkdown(
  report: AgentEvaluationRunReport,
): string {
  const lines = [
    "# Agent Evaluation Run Report",
    "",
    `- Profile: ${report.profile}`,
    `- Cases: ${report.passedCaseCount}/${report.caseCount} passed`,
    `- Result: ${report.passed ? "PASS" : "FAIL"}`,
    "",
    "| Metric | Value | Threshold | Result |",
    "| --- | ---: | ---: | --- |",
  ];
  for (const [name, threshold] of Object.entries(report.thresholds)) {
    const metricName = name as AgentEvaluationMetricName;
    const actual = report.metrics[metricName];
    const passed = actual !== null && (threshold.operator === "minimum"
      ? actual >= threshold.value
      : actual <= threshold.value);
    lines.push(
      `| ${name} | ${optionalPercent(actual)} | ` +
      `${threshold.operator} ${percent(threshold.value)} | ${passed ? "PASS" : "FAIL"} |`,
    );
  }
  if (report.thresholdFailures.length > 0) {
    lines.push("", "## Threshold failures", "");
    for (const failure of report.thresholdFailures) lines.push(`- ${failure}`);
  }
  lines.push(
    "",
    "## Categories",
    "",
    ...renderCategoryTable(report),
    "",
    "## Cases",
    "",
    ...renderCaseTable(report),
  );
  return `${lines.join("\n")}\n${report.travelProgress ? renderTravelProgressMarkdown(report.travelProgress) : ""}`;
}

function renderCategoryTable(report: AgentEvaluationReport): string[] {
  const lines = [
    "| Category | Cases | Tools | Constraints | Grounded | Unsupported | Completion |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of report.categories) {
    lines.push(
      `| ${item.category} | ${item.passedCaseCount}/${item.caseCount} | ` +
      `${percent(item.metrics.toolSelectionAccuracy)} | ` +
      `${percent(item.metrics.constraintSatisfaction)} | ` +
      `${optionalPercent(item.metrics.groundedClaimRate)} | ` +
      `${optionalPercent(item.metrics.unsupportedClaimRate)} | ` +
      `${percent(item.metrics.taskCompletion)} |`,
    );
  }
  return lines;
}

function renderCaseTable(report: AgentEvaluationReport): string[] {
  const lines = [
    "| Case | Result | Tools | Constraints | Grounded | Unsupported | Completion |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of report.cases) {
    lines.push(
      `| ${escapeCell(item.id)} | ${item.passed ? "PASS" : "FAIL"} | ` +
      `${percent(item.metrics.toolSelectionAccuracy)} | ` +
      `${percent(item.metrics.constraintSatisfaction)} | ` +
      `${optionalPercent(item.metrics.groundedClaimRate)} | ` +
      `${optionalPercent(item.metrics.unsupportedClaimRate)} | ` +
      `${percent(item.metrics.taskCompletion)} |`,
    );
    if (item.failures.length > 0) {
      lines.push(`|  | ${escapeCell(item.failures.join(" / "))} |  |  |  |  |  |`);
    }
  }
  return lines;
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
