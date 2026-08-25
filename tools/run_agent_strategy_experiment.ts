import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseAgentEvaluationDataset } from "../src/domain/agent/evaluation/evaluation-dataset";
import {
  evaluateAgentStrategyExperiment,
  parseAgentStrategyExperiment,
} from "../src/domain/agent/evaluation/strategy-experiment";
import { renderAgentStrategyExperimentMarkdown } from "../src/domain/agent/evaluation/strategy-experiment-report";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(argument("--output-dir") ??
  "/tmp/transitforge-agent-strategy-experiment");
const datasetPath = resolve(argument("--dataset") ??
  `${root}/tests/fixtures/agent-eval-cases.json`);
const experimentPath = resolve(argument("--experiment") ??
  `${root}/tests/fixtures/agent-strategy-experiment.json`);

const dataset = parseAgentEvaluationDataset(await readJson(datasetPath));
const experiment = parseAgentStrategyExperiment(await readJson(experimentPath));
const report = evaluateAgentStrategyExperiment(dataset, experiment);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    `${outputDirectory}/agent-strategy-experiment.json`,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    `${outputDirectory}/agent-strategy-experiment.md`,
    renderAgentStrategyExperimentMarkdown(report),
    "utf8",
  ),
]);

console.log(
  `Agent strategy experiment: re-plan=${report.decision.resultDrivenReplan} ` +
  `reflection=${report.decision.alwaysOnReflection} (${outputDirectory})`,
);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
