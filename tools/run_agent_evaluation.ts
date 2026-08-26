import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  parseAgentEvaluationDataset,
  parseAgentEvaluationObservations,
} from "../frontend/src/application/agent/evaluation/evaluation-dataset";
import { renderAgentEvaluationRunMarkdown } from "../frontend/src/application/agent/evaluation/evaluation-report";
import {
  runAgentEvaluationProfile,
  selectAgentEvaluationCase,
} from "../frontend/src/application/agent/evaluation/evaluation-run";
import type { AgentEvaluationProfile } from "../frontend/src/application/agent/evaluation/evaluation-contract";

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
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    `${outputDirectory}/agent-eval-report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    `${outputDirectory}/agent-eval-report.md`,
    renderAgentEvaluationRunMarkdown(report),
    "utf8",
  ),
]);

console.log(
  `Agent Eval: ${report.passedCaseCount}/${report.caseCount} passed ` +
  `(${outputDirectory})`,
);
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
