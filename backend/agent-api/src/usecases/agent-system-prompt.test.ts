import { describe, expect, it } from "vitest";

import { agentSystemPrompt } from "./agent-system-prompt.js";

describe("agentSystemPrompt", () => {
  it("keeps follow-up requests scoped to the current trip plan", () => {
    expect(agentSystemPrompt).toContain("旅程への追質問や部分変更");
    expect(agentSystemPrompt).toContain("観光の相談 人数やペースの変更 経路の部分変更ではsearch_accommodationsを使わない");
    expect(agentSystemPrompt).toContain("プロフィールと現在の旅程にある条件を聞き直さず");
    expect(agentSystemPrompt).toContain("propose_trip_updateで確認可能な変更案");
    expect(agentSystemPrompt).toContain("日帰りが明示された旅行はplan_day_trip");
    expect(agentSystemPrompt).toContain("内部推論タグや内部メモを利用者向け回答へ出さない");
    expect(agentSystemPrompt).toContain("現時点の推奨案を先に示して");
    expect(agentSystemPrompt).toContain("一度に一つの条件だけを質問");
    expect(agentSystemPrompt).toContain("Toolの失敗や入力不備");
    expect(agentSystemPrompt).toContain("内部処理の完了だけを回答にせず");
    expect(agentSystemPrompt).toContain("利用者に教えてくださいと逆に質問しない");
    expect(agentSystemPrompt).toContain("私ならそうする理由");
    expect(agentSystemPrompt).toContain("裸のYes No質問にせず");
    expect(agentSystemPrompt).toContain("地図SDKの操作説明");
  });
});
