import { test } from "node:test";
import assert from "node:assert/strict";
import { currentText, relativeTargets, implementationReferences, checkReadmeScripts, checkPreviewFlags, checkRetiredContracts } from "./check_documentation.mjs";

test("checks relative files and reference links, excludes fenced examples and external/fragment links", () => {
  assert.deepEqual(relativeTargets('[a](../a.md#title) ![img](img.png) [web](https://example.com) [local](#title)\n[ref]: b.md\n```md\n[x](missing.md)\n```'), ["../a.md", "img.png", "b.md"]);
});

test("rejects nonexistent npm scripts while retaining Historical commands", () => {
  assert.equal(checkReadmeScripts('npm run build\nnpm run absent', { build: "vite build" }).length, 1);
  assert.equal(checkReadmeScripts('npm run build\n## Historical: old\nnpm run removed', { build: "vite build" }).length, 0);
});

test("rejects a removed preview mentioned only in documentation", () => {
  const code = 'params.get("trip-workspace-preview")';
  assert.equal(checkPreviewFlags('?trip-preview=1', code).length, 1);
  assert.deepEqual(checkPreviewFlags('?trip-workspace-preview=1\n## Historical: old\n?trip-preview=1', code), []);
});

test("rejects retired Current runtime, writer and persistence contracts", () => {
  for (const prose of ['productionは`MultiStepAgentRuntime`を使う', 'Browser組成は#480まで同じcoreを利用',
    '本番writerは未有効', 'Conversationの永続正本はLocalStorage',
    '`frontend/src/usecases/agent/agent-runtime.ts`']) assert.equal(checkRetiredContracts(prose).length, 1, prose);
});

test("permits actual Browser UI storage and an explicit retired-runtime note", () => {
  const prose = '旧MultiStepAgentRuntimeは撤去済み。\nJourneySearchPreferencesはLocalStorage。\nTripの正本はServer。\n## Historical: old\n本番writerはOFF';
  assert.deepEqual(checkRetiredContracts(prose), []);
  assert.ok(!currentText(prose).includes('本番writerはOFF'));
});

test("catalog covers every current document and rejects duplicates, missing files and wrong categories", async () => {
  const { checkCatalog } = await import("./check_documentation.mjs");
  const files = ["docs/specs/weather.md", "docs/decisions/0001-choice.md"];
  assert.deepEqual(checkCatalog({ version: 1, documents: [{ path: files[0], category: "specs" }] }, files), []);
  assert.ok(checkCatalog({ version: 1, documents: [] }, files).some(error => error.includes("Unregistered")));
  assert.ok(checkCatalog({ version: 1, documents: [{ path: files[0], category: "architecture" }] }, files).some(error => error.includes("mismatch")));
  assert.ok(checkCatalog({ version: 1, documents: [{ path: "docs/specs/absent.md", category: "specs" }] }, files).some(error => error.includes("missing")));
  const entry = { path: files[0], category: "specs" };
  assert.ok(checkCatalog({ version: 1, documents: [entry, entry] }, files).some(error => error.includes("Duplicate")));
  assert.deepEqual(checkCatalog(null, files), ["Invalid documentation catalog"]);
  assert.ok(checkCatalog({ version: 1, documents: [null] }, files).includes("Invalid documentation catalog entry"));
});

test("checks concrete repository file references, excluding placeholders and historical paths", () => {
  assert.deepEqual(implementationReferences('`modules/trip/domain/trip.ts` `tools/check_documentation.mjs` `modules/*/domain` `backend/<service>/handler.ts`\n## Historical: old\n`frontend/removed.ts`'), ["modules/trip/domain/trip.ts", "tools/check_documentation.mjs"]);
});
