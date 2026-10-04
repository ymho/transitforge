import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Historical records keep their original commands and gates. Only explicit
// Current prefixes are checked for retired production contracts.
export function currentText(text) {
  return text.split(/^## Historical:/m)[0];
}

export function relativeTargets(text) {
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  const inline = [...prose.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map(match => match[1]);
  const references = [...prose.matchAll(/^\s*\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm)].map(match => match[1]);
  return [...inline, ...references].filter(target => !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target))
    .map(target => decodeURIComponent(target.split(/[?#]/)[0]));
}

export function checkReadmeScripts(text, scripts) {
  return [...currentText(text).matchAll(/\bnpm run ([\w:-]+)/g)]
    .filter(match => !Object.hasOwn(scripts, match[1]))
    .map(match => `README: missing npm script ${match[1]}`);
}

export function checkPreviewFlags(text, implementation) {
  return [...new Set([...currentText(text).matchAll(/[?&]([\w-]*preview[\w-]*)=/g)].map(match => match[1]))]
    .filter(flag => !implementation.includes(`.get("${flag}")`) && !implementation.includes(`.get('${flag}')`))
    .map(flag => `preview flag has no implementation: ${flag}`);
}

export function checkRetiredContracts(text) {
  const patterns = [
    /(?:production|本番)(?:[^\n。]*)(?:は|へ|に)\s*`?MultiStepAgentRuntime`?(?:へ一本化|を使う|を組成|が正本)/g,
    /Browser組成は#480まで[^\n]*/g,
    /(?:本番|通常UIの|公開Trip)(?:writer|保存|書込)[^\n。]*(?:未有効|未導入|OFF|後続で有効)/g,
    /(?:会話|Conversation|Profile|Trip)(?:の)?(?:永続)?正本(?:は|:|：)\s*(?:Browser\s*)?LocalStorage/g,
    /`frontend\/src\/usecases\/agent\/(?:agent-runtime|viewer-agent-runtime|search-journeys-tool|agent-trace|evidence-model)\.ts`/g,
  ];
  return patterns.flatMap(pattern => [...currentText(text).matchAll(pattern)].map(match => `retired Current contract: ${match[0]}`));
}

const currentDocuments = [
  "README.md", "docs/product-brief.md", "backend/agent-api/README.md", "infra/README.md",
  "infra/terraform/environments/dev/README.md",
  ...["domain-model", "domain-ownership", "module-boundaries", "authentication-boundary", "server-agent-cutover",
    "server-state-persistence", "travel-profile", "trip-lifecycle", "trip-server-persistence", "trip-workspace",
    "trip-state", "trip-request", "trip-schedule", "trip-feasibility", "agent-streaming-production",
    "agent-v2-development-cutover", "product-timeline-design"].map(name => `docs/architecture/${name}.md`),
];

export function checkDocumentation(root) {
  const errors = [];
  const files = execFileSync("git", ["ls-files", "-z", "--", "*.md"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const file of files) {
    for (const target of relativeTargets(readFileSync(resolve(root, file), "utf8"))) {
      if (!existsSync(resolve(root, dirname(file), target))) errors.push(`${file}: missing relative target ${target}`);
    }
  }
  const read = file => readFileSync(resolve(root, file), "utf8");
  const implementation = read("frontend/src/composition/viewer-composition.ts");
  errors.push(...checkReadmeScripts(read("README.md"), JSON.parse(read("package.json")).scripts));
  for (const file of currentDocuments) {
    errors.push(...checkPreviewFlags(read(file), implementation).map(error => `${file}: ${error}`));
    errors.push(...checkRetiredContracts(read(file)).map(error => `${file}: ${error}`));
  }
  const adrFiles = files.filter(file => /^docs\/decisions\/\d{4}-.+\.md$/.test(file) && !file.includes("0000-template"));
  const index = read("docs/decisions/README.md");
  for (const file of adrFiles) if (!index.includes(file.split("/").at(-1))) errors.push(`ADR index missing ${file}`);
  return { errors, markdownFiles: files.length, currentDocuments: currentDocuments.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkDocumentation(resolve(import.meta.dirname, ".."));
  if (result.errors.length) { console.error(result.errors.join("\n")); process.exitCode = 1; }
  else console.info(`Documentation check passed: ${result.markdownFiles} Markdown files, ${result.currentDocuments} Current documents.`);
}
