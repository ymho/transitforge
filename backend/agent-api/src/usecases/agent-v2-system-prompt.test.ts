import { describe, expect, it } from "vitest";
import { agentV2SystemPrompt } from "./agent-v2-system-prompt.js";

describe("agentV2SystemPrompt", () => {
  it("states only Application authority, Tool/Evidence grounding, and direct-answer behavior", () => {
    expect(agentV2SystemPrompt).toContain("Effective Intent");
    expect(agentV2SystemPrompt).toContain("read Tool");
    expect(agentV2SystemPrompt).toContain("Application Evidence");
    expect(agentV2SystemPrompt).toContain("既にContextで分かっている条件を聞き直さず");
    expect(agentV2SystemPrompt).toContain("実行したと主張しない");
  });

  it("does not inherit V1 runtime protocol or repair vocabulary", () => {
    for (const term of [
      "decision_summary",
      "responseText",
      "kind=answer",
      "finalization_tool_calls",
      "planning_progress_required",
      "planning_evidence_required",
      "place_photo_required",
      "repair",
      "MultiStepAgentRuntime",
    ]) expect(agentV2SystemPrompt).not.toContain(term);
  });
});
