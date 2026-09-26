import { describe, expect, it } from "vitest";
import { agentV2SystemPrompt } from "./agent-v2-system-prompt.js";
describe("agentV2SystemPrompt", () => {
  it("separates the user request, reference clock, accepted conditions and submitted reply", () => {
    for (const term of ["userMessage", "application.effectiveIntent", "clock", "read Tool", "submit_reply", "receiptId", "commentary", "自然な説明"])
      expect(agentV2SystemPrompt).toContain(term);
  });
  it("does not inherit V1 runtime protocol or repair vocabulary", () => {
    for (const term of ["decision_summary", "responseText", "finalization_tool_calls", "planning_progress_required",
      "planning_evidence_required", "place_photo_required", "repair", "MultiStepAgentRuntime"])
      expect(agentV2SystemPrompt).not.toContain(term);
  });
});
