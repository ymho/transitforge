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

  it("shows only the content inside a response block", () => {
    expect(
      visibleAssistantText(
        "<thinking>天気を確認</thinking><response>天気を雨に設定しました。</response>",
      ),
    ).toBe("天気を雨に設定しました。");
  });

  it("unwraps a response block without a closing tag", () => {
    expect(
      visibleAssistantText("<response>目的地アーチを表示しました。"),
    ).toBe("目的地アーチを表示しました。");
  });

  it("uses a complete response even when the thinking block is unclosed", () => {
    expect(
      visibleAssistantText(
        "<thinking>内部処理が途中です<response>雨に設定しました。</response>",
      ),
    ).toBe("雨に設定しました。");
  });

  it("preserves a plain response from a model that does not use tags", () => {
    expect(visibleAssistantText("模型モードに変更しました。")).toBe(
      "模型モードに変更しました。",
    );
  });
});
