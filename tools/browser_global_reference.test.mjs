import { test } from "node:test";
import assert from "node:assert/strict";
import { browserGlobalReference } from "./browser_global_reference.mjs";

test("schedule literals/comments do not depend on browser globals", () => {
  for (const code of [
    'type Schedule = { type: "window" };',
    '// window is a schedule variant\nconst label = "document localStorage";',
    'switch (schedule.type) { case "window": break; }',
    'const message = `Invalid window/duration`;',
  ]) assert.equal(browserGlobalReference(code), -1);
});

test("browser access still fails, including escaped identifiers and template expressions", () => {
  for (const code of [
    'window.location.href;', 'document.body;', 'localStorage.getItem("x");',
    'globalThis.window;', 'globalThis["window"];', 'self["document"];',
    'const text = `${window.location}`;', 'const read = window;',
    String.raw`win\u0064ow.location;`,
  ]) assert.ok(browserGlobalReference(code) >= 0, code);
});
