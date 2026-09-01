import type { AgentEvaluationReport } from "./evaluation-contract";

export interface AgentEvaluationStabilityReport {
  schemaVersion: "agent-eval-stability-v1";
  repetitions: number;
  attemptCount: number;
  passedAttemptCount: number;
  attemptPassRate: number;
  caseCount: number;
  stableCaseCount: number;
  cases: AgentEvaluationCaseStability[];
}

export interface AgentEvaluationCaseStability {
  id: string;
  name: string;
  attemptCount: number;
  passedAttemptCount: number;
  passRate: number;
  stable: boolean;
}

/** モデルの非決定性を、平均値で隠さずcase単位の再現率として集約する。 */
export function summarizeAgentEvaluationStability(
  reports: AgentEvaluationReport[],
): AgentEvaluationStabilityReport {
  if (reports.length === 0) throw new Error("集約するAgent Eval reportがありません");
  const reference = reports[0];
  const referenceIds = reference.cases.map(({ id }) => id);
  for (const report of reports.slice(1)) {
    if (report.cases.map(({ id }) => id).join("\u0000") !== referenceIds.join("\u0000")) {
      throw new Error("Agent Eval report間でcaseが一致しません");
    }
  }
  const cases = reference.cases.map((item, index) => {
    const passedAttemptCount = reports.filter((report) => report.cases[index]?.passed).length;
    return {
      id: item.id,
      name: item.name,
      attemptCount: reports.length,
      passedAttemptCount,
      passRate: passedAttemptCount / reports.length,
      stable: passedAttemptCount === reports.length,
    };
  });
  const passedAttemptCount = reports.filter((report) =>
    report.passedCaseCount === report.caseCount).length;
  return {
    schemaVersion: "agent-eval-stability-v1",
    repetitions: reports.length,
    attemptCount: reports.length,
    passedAttemptCount,
    attemptPassRate: passedAttemptCount / reports.length,
    caseCount: cases.length,
    stableCaseCount: cases.filter(({ stable }) => stable).length,
    cases,
  };
}

export function renderAgentEvaluationStabilityMarkdown(
  report: AgentEvaluationStabilityReport,
): string {
  const lines = [
    "# Agent Evaluation Stability Report",
    "",
    `- Repetitions: ${report.repetitions}`,
    `- Complete attempts: ${report.passedAttemptCount}/${report.attemptCount}`,
    `- Stable cases: ${report.stableCaseCount}/${report.caseCount}`,
    "",
    "| Case | Passed attempts | Pass rate | Stable |",
    "| --- | ---: | ---: | --- |",
    ...report.cases.map((item) =>
      `| ${escapeCell(item.id)} | ${item.passedAttemptCount}/${item.attemptCount} | ` +
      `${percent(item.passRate)} | ${item.stable ? "YES" : "NO"} |`),
  ];
  return `${lines.join("\n")}\n`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
