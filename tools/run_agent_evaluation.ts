import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluateAgentDataset } from "../src/domain/agent/evaluation/agent-evaluator";
import {
  parseAgentEvaluationDataset,
  parseAgentEvaluationObservations,
} from "../src/domain/agent/evaluation/evaluation-dataset";
import { renderAgentEvaluationMarkdown } from "../src/domain/agent/evaluation/evaluation-report";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(argument("--output-dir") ?? "/tmp/transitforge-agent-eval");
const datasetPath = resolve(
  argument("--dataset") ?? `${root}/tests/fixtures/agent-eval-cases.json`,
);
const observationsPath = resolve(
  argument("--observations") ?? `${root}/tests/fixtures/agent-eval-observations.json`,
);

const dataset = parseAgentEvaluationDataset(await readJson(datasetPath));
const observations = parseAgentEvaluationObservations(await readJson(observationsPath));
const report = evaluateAgentDataset(dataset, observations);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    `${outputDirectory}/agent-eval-report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    `${outputDirectory}/agent-eval-report.md`,
    renderAgentEvaluationMarkdown(report),
    "utf8",
  ),
]);

console.log(
  `Agent Eval: ${report.passedCaseCount}/${report.caseCount} passed ` +
  `(${outputDirectory})`,
);
if (report.passedCaseCount !== report.caseCount) process.exitCode = 1;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
