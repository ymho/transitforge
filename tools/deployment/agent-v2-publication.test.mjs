import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
test("V2 publication is independent of legacy instructions, renderers and free-prose fallbacks", () => {
  const runtime = read("backend/agent-api/src/adapters/strands-server-runtime.ts");
  assert.doesNotMatch(runtime, /grounded-answer|presentGroundedEvidence|agentDecisionContextText|buildAgentDecisionContext/u);
  assert.doesNotMatch(runtime, /response:\s*run\.response/u);
  assert.match(runtime, /admitAgentV2Reply/u);
  assert.match(runtime, /validateEvidenceAndClaims/u);
});
test("V2 submits typed references and never publishes SDK last-message text", () => {
  const engine = read("backend/agent-api/src/adapters/strands-agent-engine.ts");
  assert.doesNotMatch(engine, /\.toString\(|strandsAnswerText|responseGenerated/u);
  assert.match(engine, /AgentV2ReplySubmission/u);
  const evaluator = read("tools/strands-v2-live-evaluation.ts");
  assert.doesNotMatch(evaluator, /claimsCompletedWrite/u);
  assert.match(evaluator, /unadmitted_reply/u);
});
