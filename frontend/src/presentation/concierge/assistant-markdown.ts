export function visibleAssistantText(text: string): string {
  const responseBlocks = Array.from(
    text.matchAll(/<response\b[^>]*>([\s\S]*?)<\/response>/gi),
    (match) => withoutThinking(match[1] ?? "").trim(),
  ).filter(Boolean);
  if (responseBlocks.length > 0) return responseBlocks.join("\n\n");

  const visibleSource = withoutThinking(text);
  const unclosedResponse = visibleSource.match(/<response\b[^>]*>([\s\S]*)$/i)?.[1];
  const visibleText = (unclosedResponse ?? visibleSource)
    .replace(/<\/?response\b[^>]*>/gi, "")
    .trim();
  return visibleText || "案内を完了しました。";
}

/** AIのMarkdownは許可した最小限の記法だけDOMへ変換し HTMLとしては解釈しない。 */
export function renderAssistantMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = text.split(/\r?\n/u);
  let list: HTMLUListElement | undefined;
  const flushList = () => {
    if (list) fragment.append(list);
    list = undefined;
  };
  for (const line of lines) {
    const listMatch = /^\s*(?:[-*]|\d+\.)\s+(.+)$/u.exec(line);
    if (listMatch) {
      list ??= document.createElement("ul");
      const item = document.createElement("li");
      appendInlineMarkdown(item, listMatch[1]);
      list.append(item);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, line);
    fragment.append(paragraph);
  }
  flushList();
  return fragment;
}

function appendInlineMarkdown(target: HTMLElement, value: string): void {
  const tokens = value.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/gu);
  for (const token of tokens) {
    const bold = /^\*\*([^*]+)\*\*$/u.exec(token);
    if (bold) {
      const strong = document.createElement("strong");
      strong.textContent = bold[1];
      target.append(strong);
      continue;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/u.exec(token);
    if (link) {
      const anchor = document.createElement("a");
      anchor.textContent = link[1];
      anchor.href = link[2];
      anchor.target = "_blank";
      anchor.rel = "noreferrer";
      target.append(anchor);
      continue;
    }
    target.append(document.createTextNode(token));
  }
}

function withoutThinking(text: string): string {
  return text
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thinking\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/?thinking\b[^>]*>/gi, "");
}
