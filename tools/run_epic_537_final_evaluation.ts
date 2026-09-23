import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseEpic537FinalExpected, parseEpic537FinalInputs, parseEpic537FinalManifest,
  parseEpic537FinalObservations, runEpic537FinalEvaluation,
} from "../frontend/src/usecases/agent/evaluation/epic-537-final-evaluation";

const root = resolve(import.meta.dirname, "..");
const fixtures = resolve(argument("--fixtures") ?? `${root}/tests/fixtures/epic-537-final-eval`);
const output = resolve(argument("--output") ?? `${argument("--output-dir") ?? "/tmp/transitforge-epic-537-final-eval"}/report.json`);
const [inputs, expected, observations, manifest] = await Promise.all([
  read("inputs.json"), read("expected.json"), read("observations.json"), read("manifest.json"),
]);
const report = runEpic537FinalEvaluation(parseEpic537FinalInputs(inputs), parseEpic537FinalExpected(expected),
  parseEpic537FinalObservations(observations), parseEpic537FinalManifest(manifest));
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
const measured = report.cases.filter(({ status }) => status === "measured");
const passed = measured.filter(({ passed: result }) => result === true).length;
const unmeasured = report.cases.length - measured.length;
console.log(`Epic #537 final Eval: ${passed}/${measured.length} measured cases passed; ${unmeasured} not measured; A/B never substitute C/D (${output})`);
if (report.cases.some(({ passed }) => passed === false)) process.exitCode = 1;

async function read(name: string): Promise<unknown> { return JSON.parse(await readFile(resolve(fixtures, name), "utf8")); }
function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
