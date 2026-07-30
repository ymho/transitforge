import { describe, expect, it } from "vitest";

import { visibleAssistantText } from "./ai-guide-panel";

describe("AI guide panel assistant text", () => {
  it("removes a thinking block while preserving the visible answer", () => {
    expect(
      visibleAssistantText(
        "<thinking>\n候補を比較します。\n</thinking>\n模型モードに変更しました。",
      ),
    ).toBe("模型モードに変更しました。");
  });

  it("does not display an unclosed thinking block", () => {
    expect(
      visibleAssistantText("混雑表示を有効にしました。\n<thinking>追加の検討"),
    ).toBe("混雑表示を有効にしました。");
  });

  it("uses a completion message when only thinking is returned", () => {
    expect(visibleAssistantText("<THINKING>内部処理</THINKING>")).toBe(
      "案内を完了しました。",
    );
  });
});
