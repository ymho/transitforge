import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentTrace } from "../frontend/src/usecases/agent/agent-trace";
import type { AgentEvaluationReport } from "../frontend/src/usecases/agent/evaluation/evaluation-contract";
import { createAgentModelRoutingRun } from "../frontend/src/usecases/agent/evaluation/model-routing-experiment";

const strategy = requiredArgument("--strategy");
const report = JSON.parse(await readFile(resolve(requiredArgument("--report")), "utf8")) as AgentEvaluationReport;
const traces = JSON.parse(await readFile(resolve(requiredArgument("--traces")), "utf8")) as AgentTrace[];
const outputPath = resolve(argument("--output") ?? "/tmp/raiquora-model-routing-run.json");
const run = createAgentModelRoutingRun(strategy, report, traces);
await writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
console.log(`Agent model routing run: ${run.passedCaseCount}/${run.caseCount} (${outputPath})`);

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`${name}が必要です`);
  return value;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
