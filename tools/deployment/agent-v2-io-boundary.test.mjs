import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (name) => readFileSync(new URL(`../../backend/agent-api/src/adapters/${name}.ts`, import.meta.url), "utf8");

test("V2 input is a data projection, not the old instruction serializer", () => {
  const runtime = source("strands-server-runtime");
  assert.doesNotMatch(runtime, /agentDecisionContextText|buildAgentDecisionContext/u);
  assert.match(runtime, /modelInput: strandsTurnInput\(input\)/u);
  assert.doesNotMatch(source("strands-turn-input"), /import\s*\{[^}]*\}\s*from/u);
});
test("V2 does not stringify SDK results or auto-publish unadmitted prose", () => {
  assert.doesNotMatch(source("strands-agent-engine"), /result\.toString\(/u);
  assert.doesNotMatch(source("strands-server-runtime"), /response:\s*run\.response/u);
});
