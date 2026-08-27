import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

const directory = process.argv[2] ?? "dist/assets";
const budgets = {
  index: 650 * 1024,
  mapbox: 1_900 * 1024,
  three: 900 * 1024,
  validation: 250 * 1024,
};

const files = (await readdir(directory)).filter((file) => file.endsWith(".js"));
const failures = [];
for (const file of files) {
  const family = Object.keys(budgets).find((name) => file.startsWith(`${name}-`));
  if (!family) continue;
  const size = (await stat(join(directory, file))).size;
  if (size > budgets[family]) failures.push(`${basename(file)}: ${size} > ${budgets[family]} bytes`);
}
if (!files.some((file) => file.startsWith("index-"))) failures.push("initial index chunk not found");
if (failures.length > 0) {
  console.error(`Bundle budget exceeded\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Bundle budget: OK");
}
