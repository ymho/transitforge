import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(repositoryRoot, "src");

const layerRules = {
  domain: {
    forbiddenLayers: new Set([
      "data",
      "features",
      "infrastructure",
      "observability",
      "presentation",
      "rendering",
    ]),
    forbidExternalPackages: true,
  },
  features: {
    forbiddenLayers: new Set(["data", "infrastructure", "rendering"]),
  },
  data: {
    forbiddenLayers: new Set([
      "features",
      "infrastructure",
      "presentation",
      "rendering",
    ]),
  },
  presentation: {
    forbiddenLayers: new Set(["data", "infrastructure", "rendering"]),
  },
  rendering: {
    forbiddenLayers: new Set(["features", "infrastructure", "presentation"]),
  },
  infrastructure: {
    forbiddenLayers: new Set(["data", "features", "presentation", "rendering"]),
  },
};

const migrationExceptions = [
  ...[
    "src/domain/congestion-analysis.ts",
    "src/domain/delay-analysis.ts",
    "src/domain/direct-route-search.ts",
    "src/domain/journey-navigation-intent.ts",
    "src/domain/network-inspection-service.ts",
    "src/domain/path-line-colors.ts",
    "src/domain/train-detail-service.ts",
    "src/domain/train-formation-link.ts",
    "src/domain/train-line-color.ts",
    "src/domain/train-operation-state.ts",
    "src/domain/train-position.ts",
    "src/domain/viewer-agent-bedrock.ts",
    "src/domain/viewer-agent-local-tools.ts",
    "src/domain/viewer-agent-local.ts",
    "src/domain/agent/operational-analysis-tools.ts",
  ].map((source) => ({ source, kind: "layer:data", issue: 157 })),
  {
    source: "src/domain/viewer-agent-local.ts",
    kind: "layer:presentation",
    issue: 158,
  },
  {
    source: "src/domain/map-weather.ts",
    kind: "external:mapbox-gl",
    issue: 157,
  },
  {
    source: "src/domain/digital-twin-clock.ts",
    kind: "browser-globals",
    issue: 157,
  },
  ...[
    "src/presentation/ai-guide-panel.ts",
    "src/presentation/train-selection-controller.ts",
    "src/presentation/train-timetable.ts",
    "src/presentation/train-title.ts",
  ].map((source) => ({
    source,
    kind: "layer:data",
    issue: source.includes("ai-guide") ? 159 : 157,
  })),
  {
    source: "src/presentation/train-selection-controller.ts",
    kind: "layer:rendering",
    issue: 159,
  },
];

const usedExceptions = new Set();
const violations = [];

for (const absolutePath of sourceFiles(sourceRoot)) {
  const source = repositoryPath(absolutePath);
  const layer = source.split("/")[1];
  const rule = layerRules[layer];
  if (!rule) continue;

  const content = readFileSync(absolutePath, "utf8");
  for (const imported of importedSpecifiers(content)) {
    const targetLayer = localTargetLayer(absolutePath, imported.specifier);
    if (targetLayer && rule.forbiddenLayers.has(targetLayer)) {
      recordOrAllow({
        source,
        kind: `layer:${targetLayer}`,
        line: lineNumber(content, imported.index),
        message: `${layer}から${targetLayer}への依存は禁止されています`,
      });
      continue;
    }
    if (
      rule.forbidExternalPackages &&
      !imported.specifier.startsWith(".") &&
      !imported.specifier.startsWith("node:")
    ) {
      recordOrAllow({
        source,
        kind: `external:${packageName(imported.specifier)}`,
        line: lineNumber(content, imported.index),
        message: `domainから外部package ${packageName(imported.specifier)} への依存は禁止されています`,
      });
    }
  }

  if (layer === "domain" && /\b(?:window|document|localStorage)\b/.test(content)) {
    recordOrAllow({
      source,
      kind: "browser-globals",
      line: lineNumber(content, content.search(/\b(?:window|document|localStorage)\b/)),
      message: "domainからbrowser globalへの依存は禁止されています",
    });
  }
}

const staleExceptions = migrationExceptions.filter(
  (_, index) => !usedExceptions.has(index),
);

if (violations.length > 0 || staleExceptions.length > 0) {
  for (const violation of violations) {
    console.error(
      `${violation.source}:${violation.line} ${violation.message} (${violation.kind})`,
    );
  }
  for (const exception of staleExceptions) {
    console.error(
      `${exception.source} の移行例外 ${exception.kind} は不要です Issue #${exception.issue} と一緒に削除してください`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries: OK");
}

function recordOrAllow(violation) {
  const exceptionIndex = migrationExceptions.findIndex(
    (exception) =>
      exception.source === violation.source && exception.kind === violation.kind,
  );
  if (exceptionIndex >= 0) {
    usedExceptions.add(exceptionIndex);
    return;
  }
  violations.push(violation);
}

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) return [];
    return [path];
  });
}

function importedSpecifiers(content) {
  const imports = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\()(["'])([^"']+)\1/g;
  for (const match of content.matchAll(pattern)) {
    imports.push({ specifier: match[2], index: match.index ?? 0 });
  }
  return imports;
}

function localTargetLayer(source, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const target = resolve(dirname(source), specifier);
  const targetRelative = relative(sourceRoot, target);
  if (targetRelative.startsWith("..")) return undefined;
  return targetRelative.split(sep)[0];
}

function packageName(specifier) {
  if (!specifier.startsWith("@")) return specifier.split("/")[0];
  return specifier.split("/").slice(0, 2).join("/");
}

function repositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function lineNumber(content, index) {
  return content.slice(0, Math.max(index, 0)).split("\n").length;
}
