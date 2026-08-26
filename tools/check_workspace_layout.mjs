import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const expectedWorkspaces = ["frontend", "backend/*", "modules/*", "lib"];
const errors = [];

const rootPackage = readJson(resolve(repositoryRoot, "package.json"));
const lockfile = readJson(resolve(repositoryRoot, "package-lock.json"));
const rootTsconfig = readJson(resolve(repositoryRoot, "tsconfig.json"));
const frontendRoot = resolve(repositoryRoot, "frontend");

if (rootPackage.private !== true) {
  errors.push("root package.jsonはprivateである必要があります");
}
if (JSON.stringify(rootPackage.workspaces) !== JSON.stringify(expectedWorkspaces)) {
  errors.push(`root workspacesは${expectedWorkspaces.join(", ")}を正本にしてください`);
}
if (lockfile.lockfileVersion !== 3) {
  errors.push("package-lock.jsonはlockfileVersion 3を使用してください");
}
if (rootTsconfig.extends !== "./tsconfig.base.json") {
  errors.push("root tsconfig.jsonはtsconfig.base.jsonを継承してください");
}
if (!existsSync(resolve(repositoryRoot, "tsconfig.base.json"))) {
  errors.push("共有tsconfig.base.jsonが必要です");
}

for (const lockPath of findNamedFiles(repositoryRoot, "package-lock.json")) {
  if (lockPath !== resolve(repositoryRoot, "package-lock.json")) {
    errors.push(`${repositoryPath(lockPath)}を削除しroot lockfileへ統一してください`);
  }
}

for (const directory of existingWorkspaceDirectories()) {
  const manifestPath = resolve(directory, "package.json");
  if (!existsSync(manifestPath)) {
    errors.push(`${repositoryPath(directory)}にpackage.jsonがありません`);
    continue;
  }
  const manifest = readJson(manifestPath);
  if (manifest.private !== true) {
    errors.push(`${repositoryPath(manifestPath)}はprivateである必要があります`);
  }
}

for (const requiredPath of [
  "frontend/package.json",
  "frontend/tsconfig.json",
  "frontend/vite.config.ts",
  "frontend/index.html",
  "frontend/src/main.ts",
  "frontend/public",
  "frontend/src/presentation/concierge",
  "frontend/src/presentation/trip-plan",
  "frontend/src/presentation/train-viewer/rendering",
  "frontend/src/presentation/shared",
  "frontend/src/presentation/styles/viewer.css",
]) {
  if (!existsSync(resolve(repositoryRoot, requiredPath))) {
    errors.push(`${requiredPath}が必要です`);
  }
}
for (const obsoletePath of [
  "frontend/src/rendering",
  "frontend/src/styles",
  "frontend/src/viewer.css",
  "frontend/src/features/concierge/presentation",
  "frontend/src/features/trip-plan/presentation",
  "frontend/src/features/train-viewer/presentation",
]) {
  if (existsSync(resolve(repositoryRoot, obsoletePath))) {
    errors.push(`${obsoletePath}はfrontend/src/presentationの機能別ディレクトリへ統一してください`);
  }
}
if (existsSync(resolve(repositoryRoot, "src"))) {
  errors.push("root srcはfrontend/srcへ統一してください");
}
if (existsSync(resolve(repositoryRoot, "public"))) {
  errors.push("root publicはfrontend/publicへ統一してください");
}
if (existsSync(resolve(repositoryRoot, "vite.config.ts"))) {
  errors.push("root vite.config.tsはfrontendへ統一してください");
}
if (existsSync(frontendRoot)) {
  const frontendPackage = readJson(resolve(frontendRoot, "package.json"));
  if (frontendPackage.name !== "@raiquora/frontend") {
    errors.push("frontend package名は@raiquora/frontendにしてください");
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log("Workspace layout: OK");
}

function existingWorkspaceDirectories() {
  const directories = [];
  for (const name of ["frontend", "lib"]) {
    const directory = resolve(repositoryRoot, name);
    if (existsSync(directory)) directories.push(directory);
  }
  for (const parentName of ["backend", "modules"]) {
    const parent = resolve(repositoryRoot, parentName);
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent)) {
      const directory = resolve(parent, name);
      if (statSync(directory).isDirectory()) directories.push(directory);
    }
  }
  return directories;
}

function findNamedFiles(directory, filename) {
  return readdirSync(directory).flatMap((name) => {
    if (name === ".git" || name === "node_modules" || name === "dist") return [];
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return findNamedFiles(path, filename);
    return name === filename ? [path] : [];
  });
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${repositoryPath(path)}をJSONとして読み取れません`);
    return {};
  }
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join("/") || ".";
}
