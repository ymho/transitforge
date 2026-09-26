import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../../.github/workflows/strands-v2-live.yml", import.meta.url), "utf8");

test("Strands v2 Live case selection is closed and defaults to all", () => {
  assert.match(workflow, /case_id:[\s\S]*default: "all"[\s\S]*type: choice/u);
  for (const value of ["all", "tool-grounding", "write-not-available"]) {
    assert.ok(workflow.includes(`- "${value}"`));
  }
  assert.doesNotMatch(workflow, /case_id:[\s\S]{0,180}type: string/u);
  assert.match(workflow, /case "\$CASE_ID" in[\s\S]*all\) cases=2[\s\S]*tool-grounding\|write-not-available\) cases=1/u);
});

test("Strands v2 Live passes --case only for an exact named case", () => {
  assert.match(workflow, /if \[\[ "\$CASE_ID" != "all" \]\]; then args\+=\(--case "\$CASE_ID"\); fi/u);
  assert.doesNotMatch(workflow, /if \[\[ -n "\$CASE_ID" \]\]; then args\+=\(--case/u);
});

test("Strands v2 Live summary cannot execute markdown backticks as shell commands", () => {
  const budget = workflow.match(/- name: Fix bounded execution budget[\s\S]*?- name: Run Strands v2 live evaluation/u)?.[0] ?? "";
  assert.ok(budget);
  assert.doesNotMatch(budget, /echo "[^"]*`/u);
  assert.match(budget, /echo "- Model: \$MODEL_ID"/u);
  assert.match(workflow, /if-no-files-found: warn/u);
});
