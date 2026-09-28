import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateTripV2Product, type TripV2Observation } from "./trip-v2-product-gate.js";

const input = process.argv[2];
if (!input || input.startsWith("--")) throw new Error("usage: npm run eval:trip:v2 -- /path/to/observations.json [/path/to/report.json] [--require-all]");
const observations: unknown = JSON.parse(await readFile(resolve(input), "utf8"));
if (!Array.isArray(observations)) throw new Error("observations must be an array");
const report = evaluateTripV2Product(observations as TripV2Observation[]);
const destination = resolve(process.argv[3]?.startsWith("--") || !process.argv[3]
  ? "/tmp/trip-v2-product-evaluation/report.json" : process.argv[3]);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ complete: report.complete, passed: report.observations.filter(x => x.status === "passed").length,
  missing: report.missing.length, failed: report.failed.length, report: destination }));
if (process.argv.includes("--require-all") && !report.complete) process.exitCode = 1;
