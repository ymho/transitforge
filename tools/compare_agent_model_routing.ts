import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  compareAgentModelRouting,
  parseAgentModelRoutingRun,
} from "../frontend/src/usecases/agent/evaluation/model-routing-experiment";

const baselinePath = requiredArgument("--baseline");
const candidatePath = requiredArgument("--candidate");
const outputPath = resolve(argument("--output") ?? "/tmp/raiquora-model-routing-comparison.json");
const baseline = parseAgentModelRoutingRun(JSON.parse(await readFile(resolve(baselinePath), "utf8")));
const candidate = parseAgentModelRoutingRun(JSON.parse(await readFile(resolve(candidatePath), "utf8")));
const comparison = compareAgentModelRouting(baseline, candidate);
await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
console.log(
  `Agent model routing: quality=${comparison.qualityMaintained} ` +
  `cost=${comparison.costImproved} recommend=${comparison.productionRoutingRecommended} (${outputPath})`,
);

function requiredArgument(name: string): string {
  const value = argument(name);
  if (!value) throw new Error(`${name}が必要です`);
  return value;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
