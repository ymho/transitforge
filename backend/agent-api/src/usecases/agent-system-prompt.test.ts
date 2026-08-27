import { describe, expect, it } from "vitest";

import { agentSystemPrompt } from "./agent-system-prompt.js";

describe("agentSystemPrompt", () => {
  it("keeps follow-up requests scoped to the current trip plan", () => {
    expect(agentSystemPrompt).toContain("旅程への追質問や部分変更");
    expect(agentSystemPrompt).toContain("観光の相談 人数やペースの変更 経路の部分変更ではsearch_accommodationsを使わない");
    expect(agentSystemPrompt).toContain("プロフィールと現在の旅程にある条件を聞き直さず");
    expect(agentSystemPrompt).toContain("propose_trip_updateで確認可能な変更案");
  });
});
