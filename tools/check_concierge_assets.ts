import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { concierges } from "../frontend/src/features/concierge/profiles";

const assetDirectory = resolve(import.meta.dirname, "../frontend/public/assets/concierges");
const expectedFiles = new Set<string>();
const errors: string[] = [];

for (const concierge of concierges) {
  const expectedPath = `/assets/concierges/${concierge.id}.webp`;
  if (concierge.presentation.image !== expectedPath) {
    errors.push(`${concierge.id}: imageは${expectedPath}にしてください`);
    continue;
  }
  expectedFiles.add(`${concierge.id}.webp`);
  try {
    const image = await readFile(resolve(assetDirectory, `${concierge.id}.webp`));
    if (!isWebp(image)) errors.push(`${concierge.id}: WebP形式ではありません`);
  } catch {
    errors.push(`${concierge.id}: 画像が存在しません`);
  }
}

for (const file of await readdir(assetDirectory)) {
  if (file.endsWith(".webp") && !expectedFiles.has(file)) {
    errors.push(`${file}: 参照するプロフィールがありません`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Concierge assets: OK (${expectedFiles.size})`);
}

function isWebp(value: Uint8Array): boolean {
  return value.length >= 12 &&
    ascii(value, 0, 4) === "RIFF" &&
    ascii(value, 8, 12) === "WEBP";
}

function ascii(value: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...value.slice(start, end));
}
