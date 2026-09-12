import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  parseAgentEvaluationDataset,
  parseAgentEvaluationObservations,
} from "../frontend/src/usecases/agent/evaluation/evaluation-dataset";
import { renderAgentEvaluationRunMarkdown } from "../frontend/src/usecases/agent/evaluation/evaluation-report";
import {
  runAgentEvaluationProfile,
  selectAgentEvaluationCase,
} from "../frontend/src/usecases/agent/evaluation/evaluation-run";
import type { AgentEvaluationProfile } from "../frontend/src/usecases/agent/evaluation/evaluation-contract";
import { progressCaseIds, runAskProgressCase } from "../frontend/src/adapters/bedrock/ask-progress-scenarios.fixture";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(argument("--output-dir") ?? "/tmp/transitforge-agent-eval");
const datasetPath = resolve(
  argument("--dataset") ?? `${root}/tests/fixtures/agent-eval-cases.json`,
);
const observationsPath = resolve(
  argument("--observations") ?? `${root}/tests/fixtures/agent-eval-observations.json`,
);
const profile = parseProfile(argument("--profile") ?? "full");

const parsedDataset = parseAgentEvaluationDataset(await readJson(datasetPath));
const parsedObservations = parseAgentEvaluationObservations(await readJson(observationsPath));
const selectedCaseId = argument("--case");
const selection = selectedCaseId === undefined
  ? { dataset: parsedDataset, observations: parsedObservations }
  : selectAgentEvaluationCase(parsedDataset, parsedObservations, selectedCaseId);
const report = {
  ...runAgentEvaluationProfile(selection.dataset, selection.observations, profile),
  ...(selectedCaseId === undefined ? {} : { selectedCaseId }),
};
// Unlike recorded observations, these acceptance cases execute the production runtime
// with authored model/tool fixtures on every run. This does not measure live model quality.
const progressCases = selectedCaseId ? [] : profile === "smoke" ? ["A-vague", "G-consecutive"] as const : progressCaseIds;
const askProgress = [];
for (const id of progressCases) {
  const result = await runAskProgressCase(id);
  askProgress.push({ id, failures: result.failures, observation: result.observation, modelCalls: result.calls,
    toolCalls: result.trace?.events.filter((e) => e.type === "tool_called").length });
}
if (askProgress.some((item) => item.failures.length)) report.passed = false;
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    `${outputDirectory}/agent-eval-report.json`,
    `${JSON.stringify({ ...report, askProgress }, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    `${outputDirectory}/agent-eval-report.md`,
    renderAgentEvaluationRunMarkdown(report) + "\n## Ask + Progress（本番Runtime / scripted model）\n\n" +
      askProgress.map((c) => `- ${c.id}: ${c.failures.length ? "FAIL: " + c.failures.join(", ") : "PASS"}; ${c.observation?.outcome ?? "incomplete"}; model ${c.modelCalls}, tool ${c.toolCalls}`).join("\n") + "\n",
    "utf8",
  ),
]);

console.log(
  `Agent Eval: ${report.passedCaseCount}/${report.caseCount} passed ` +
  `(${outputDirectory})`,
);
console.log(`Ask + Progress (production runtime / scripted model): ${askProgress.filter((c) => !c.failures.length).length}/${askProgress.length} passed`);
if (!report.passed) process.exitCode = 1;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseProfile(value: string): AgentEvaluationProfile {
  if (value !== "smoke" && value !== "full") {
    throw new Error("--profileはsmokeまたはfullで指定してください");
  }
  return value;
}
