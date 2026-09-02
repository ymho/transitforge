import { describe, expect, it } from "vitest";
import { parseAssistantMarkdown, visibleAssistantText } from "./assistant-markdown";

describe("assistant markdown", () => {
  it("parses common block and inline syntax into a safe display model", () => {
    const blocks = parseAssistantMarkdown([
      "# 見出し",
      "",
      "> **根拠**を確認します。",
      "",
      "1. 一つ目",
      "2. 二つ目",
      "",
      "```ts",
      "const safe = true;",
      "```",
      "",
      "| 項目 | 内容 |",
      "| --- | --- |",
      "| 移動 | 鉄道 |",
    ].join("\n"));

    expect(blocks.map(({ kind }) => kind)).toEqual(["heading", "quote", "list", "code", "table"]);
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(blocks[3]).toMatchObject({ kind: "code", language: "ts" });
  });

  it("keeps unsafe HTML and URLs out of executable nodes", () => {
    const blocks = parseAssistantMarkdown("<script>alert(1)</script> [危険](javascript:alert(1))");
    expect(JSON.stringify(blocks)).not.toContain('"kind":"link"');
    expect(JSON.stringify(blocks)).toContain("script");
  });

  it("keeps response and thinking boundaries", () => {
    expect(visibleAssistantText("<thinking>秘密</thinking><response>**案内**</response>"))
      .toBe("**案内**");
  });
});
