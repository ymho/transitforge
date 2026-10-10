// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { admitAgentV2Reply } from "@raiquora/agent/agent-v2-publication";
import type { Evidence } from "@raiquora/agent/evidence-model";
import { publicCommentaryMarkdown } from "../../../../backend/agent-api/src/adapters/public-commentary-markdown.js";
import { renderAssistantMarkdown } from "./assistant-markdown";

const evidence: Evidence = { id: "verified", category: "external", knowledgeKind: "deterministic_fact",
  subject: "確認済み資料", facts: { description: "確認済みの案内です。" },
  references: [{ sourceType: "external-source", sourceRef: "https://example.test/verified", freshness: "current",
    retrievedAt: "2026-10-10T00:00:00Z", summary: "合成資料" }] };
const context = { renderCommentary: publicCommentaryMarkdown, executionId: "markdown-publication", evidence: [evidence] };
function render(proposal: unknown) {
  const admitted = admitAgentV2Reply(proposal, context);
  const view = document.createElement("div");
  view.append(renderAssistantMarkdown(admitted.text));
  return { admitted, view };
}

it("preserves formatting through actual admission and safe DOM rendering, with only verified source links", () => {
  const commentary = "## 候補の比較\n\n**経路1（推奨）**\n\n確認してください。\n\n1. **速さ**を比較\n2. 乗換を比較\n\n- 候補を選ぶ\n- 詳細を確認";
  const { admitted, view } = render({ kind: "answer", commentary,
    references: [{ evidenceId: "verified", field: "description" }],
    nextQuestion: { target: "departure_time", text: "**出発時刻**はいつですか？" } });
  expect(view.querySelector("h3")?.textContent).toBe("候補の比較");
  expect([...view.querySelectorAll("strong")].map(node => node.textContent)).toEqual(["経路1（推奨）", "速さ", "出発時刻"]);
  expect(view.querySelectorAll("ol li")).toHaveLength(2);
  expect(view.querySelectorAll("ul li")).toHaveLength(2);
  expect([...view.querySelectorAll("a")].map(node => node.href)).toEqual([evidence.references[0]!.sourceRef]);
  expect(admitted.claims[0]?.statement).toBe(commentary);
});

it("keeps model links, autolinks, reference links, images and HTML inert, including credential-bearing URLs", () => {
  const text = '[未承認](https://bad.test/?token=private) https://localhost/path <https://bad.test>\n\n![画像](https://bad.test/pixel "Raiquora verified photo")\n\n<a href="https://bad.test">HTML</a>\n\n[参照][ref]\n\n[ref]: https://bad.test/ref';
  const { view } = render({ kind: "conversation", message: "acknowledgement", text });
  expect(view.querySelectorAll("a, img, script")).toHaveLength(0);
  expect(view.textContent).toContain("[未承認](https://bad.test/?token=private)");
  expect(view.textContent).toContain('<a href="https://bad.test">HTML</a>');
});

it("preserves deliberately escaped punctuation and literal code without enabling code contents", () => {
  const { view } = render({ kind: "conversation", message: "acknowledgement",
    text: '\\*\\*通常の記号\\*\\*と `**コード** [x](https://bad.test)`\n\n```html\n<img src="https://bad.test">\n**コード内の太字**\n```' });
  expect(view.querySelectorAll("strong, a, img")).toHaveLength(0);
  expect(view.textContent).toContain("**通常の記号**");
  expect([...view.querySelectorAll("code")].map(node => node.textContent)).toEqual([
    "**コード** [x](https://bad.test)", '<img src="https://bad.test">\n**コード内の太字**',
  ]);
});

it("formats section bodies, conversation, uncertainty and contextual questions through the same boundary", () => {
  const { view } = render({ kind: "answer", references: [{ evidenceId: "verified", field: "description" }],
    sections: [{ heading: "確認事項", text: "**案内**を確認してください。" }] });
  expect(view.querySelector("strong")?.textContent).toBe("案内");
  for (const proposal of [{ kind: "uncertainty", text: "**未確認**です。" },
    { kind: "clarification", target: "destination", text: "**行き先**を登録してください。" }]) {
    expect(render(proposal).view.querySelector("strong")).not.toBeNull();
  }
});
