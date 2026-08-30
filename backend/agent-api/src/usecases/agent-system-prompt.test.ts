import { describe, expect, it } from "vitest";

import { agentSystemPrompt } from "./agent-system-prompt.js";

describe("agentSystemPrompt", () => {
  it("keeps decision principles while delegating capability selection to descriptors", () => {
    expect(agentSystemPrompt).toContain("goal hard constraint soft preference");
    expect(agentSystemPrompt).toContain("既知の条件を聞き直さず");
    expect(agentSystemPrompt).toContain("一度に一つ短く確認");
    expect(agentSystemPrompt).toContain("Toolの能力 適するケース 適さないケース");
    expect(agentSystemPrompt).toContain("Tool結果を受け取るたびに");
    expect(agentSystemPrompt).toContain("Tool失敗時は別の能力");
    expect(agentSystemPrompt).toContain("内部処理の完了だけを回答にしない");
    expect(agentSystemPrompt).toContain("利用者へ逆質問しない");
    expect(agentSystemPrompt).toContain("私ならそうする理由");
    expect(agentSystemPrompt).toContain("地図SDKの操作説明");
    expect(agentSystemPrompt).toContain("Chain-of-Thought");
    expect(agentSystemPrompt).not.toContain("search_accommodations");
    expect(agentSystemPrompt).not.toContain("plan_day_trip");
    expect(agentSystemPrompt).not.toContain("search_place_media");
  });
});
