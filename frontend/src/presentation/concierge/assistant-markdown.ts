import { marked, type Token, type Tokens } from "marked";

type InlineNode =
  | { kind: "text"; value: string }
  | { kind: "strong" | "emphasis" | "deleted"; children: InlineNode[] }
  | { kind: "code"; value: string }
  | { kind: "link"; href: string; title?: string; children: InlineNode[] }
  | { kind: "break" };

export type AssistantMarkdownBlock =
  | { kind: "paragraph"; children: InlineNode[] }
  | { kind: "heading"; level: number; children: InlineNode[] }
  | { kind: "list"; ordered: boolean; start?: number; items: AssistantMarkdownBlock[][] }
  | { kind: "quote"; children: AssistantMarkdownBlock[] }
  | { kind: "code"; value: string; language?: string }
  | { kind: "rule" }
  | { kind: "table"; header: InlineNode[][]; rows: InlineNode[][][] };

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

/** MarkdownをHTMLへ変換せず、安全な表示モデルへ限定する。 */
export function parseAssistantMarkdown(text: string): AssistantMarkdownBlock[] {
  return blockNodes(marked.lexer(text, { gfm: true, breaks: true }));
}

export function renderAssistantMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendBlocks(fragment, parseAssistantMarkdown(text));
  return fragment;
}

function blockNodes(tokens: Token[]): AssistantMarkdownBlock[] {
  return tokens.flatMap((token): AssistantMarkdownBlock[] => {
    switch (token.type) {
      case "space":
      case "def":
        return [];
      case "heading":
        return [{ kind: "heading", level: Math.min(6, Math.max(2, token.depth + 1)), children: inlineNodes(nestedTokens(token)) }];
      case "paragraph":
        return [{ kind: "paragraph", children: inlineNodes(nestedTokens(token)) }];
      case "text":
        return [{ kind: "paragraph", children: inlineNodes(token.tokens ?? [token]) }];
      case "list": {
        const list = token as Tokens.List;
        return [{
          kind: "list",
          ordered: list.ordered,
          ...(typeof list.start === "number" ? { start: list.start } : {}),
          items: list.items.map((item: Tokens.ListItem) => blockNodes(item.tokens)),
        }];
      }
      case "blockquote":
        return [{ kind: "quote", children: blockNodes(nestedTokens(token)) }];
      case "code": {
        const language = safeLanguage(token.lang);
        return [{ kind: "code", value: token.text, ...(language ? { language } : {}) }];
      }
      case "hr":
        return [{ kind: "rule" }];
      case "table": {
        const table = token as Tokens.Table;
        return [{
          kind: "table",
          header: table.header.map((cell: Tokens.TableCell) => inlineNodes(cell.tokens)),
          rows: table.rows.map((row: Tokens.TableCell[]) => row.map((cell: Tokens.TableCell) => inlineNodes(cell.tokens))),
        }];
      }
      case "html":
        return [{ kind: "paragraph", children: [{ kind: "text", value: token.text }] }];
      default:
        return blockNodes(nestedTokens(token));
    }
  });
}

function inlineNodes(tokens: Token[]): InlineNode[] {
  return tokens.flatMap((token): InlineNode[] => {
    switch (token.type) {
      case "text":
      case "escape":
        return nestedTokens(token).length > 0 ? inlineNodes(nestedTokens(token)) : [{ kind: "text", value: token.text }];
      case "strong":
        return [{ kind: "strong", children: inlineNodes(nestedTokens(token)) }];
      case "em":
        return [{ kind: "emphasis", children: inlineNodes(nestedTokens(token)) }];
      case "del":
        return [{ kind: "deleted", children: inlineNodes(nestedTokens(token)) }];
      case "codespan":
        return [{ kind: "code", value: token.text }];
      case "br":
        return [{ kind: "break" }];
      case "link": {
        const href = safeExternalHttpUrl(token.href);
        return href
          ? [{ kind: "link", href, ...(token.title ? { title: token.title } : {}), children: inlineNodes(nestedTokens(token)) }]
          : inlineNodes(nestedTokens(token));
      }
      case "image": {
        const href = safeExternalHttpUrl(token.href);
        return href
          ? [{ kind: "link", href, children: [{ kind: "text", value: token.text || "画像" }] }]
          : [{ kind: "text", value: token.text }];
      }
      case "html":
        return [{ kind: "text", value: token.text }];
      default:
        return inlineNodes(nestedTokens(token));
    }
  });
}

function appendBlocks(container: DocumentFragment | HTMLElement, blocks: AssistantMarkdownBlock[]): void {
  for (const block of blocks) {
    if (block.kind === "paragraph" || block.kind === "heading") {
      const element = block.kind === "paragraph"
        ? document.createElement("p")
        : document.createElement(`h${block.level}`);
      appendInline(element, block.children);
      container.append(element);
    } else if (block.kind === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      if (block.ordered && block.start !== undefined) (list as HTMLOListElement).start = block.start;
      for (const itemBlocks of block.items) {
        const item = document.createElement("li");
        appendBlocks(item, itemBlocks);
        list.append(item);
      }
      container.append(list);
    } else if (block.kind === "quote") {
      const quote = document.createElement("blockquote");
      appendBlocks(quote, block.children);
      container.append(quote);
    } else if (block.kind === "code") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.value;
      if (block.language) code.dataset.language = block.language;
      pre.append(code);
      container.append(pre);
    } else if (block.kind === "rule") {
      container.append(document.createElement("hr"));
    } else {
      const wrapper = document.createElement("div");
      wrapper.className = "assistant-markdown-table-scroll";
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const cell of block.header) {
        const element = document.createElement("th");
        appendInline(element, cell);
        headRow.append(element);
      }
      head.append(headRow);
      const body = document.createElement("tbody");
      for (const row of block.rows) {
        const rowElement = document.createElement("tr");
        for (const cell of row) {
          const element = document.createElement("td");
          appendInline(element, cell);
          rowElement.append(element);
        }
        body.append(rowElement);
      }
      table.append(head, body);
      wrapper.append(table);
      container.append(wrapper);
    }
  }
}

function appendInline(container: HTMLElement, nodes: InlineNode[]): void {
  for (const node of nodes) {
    if (node.kind === "text") container.append(document.createTextNode(node.value));
    else if (node.kind === "break") container.append(document.createElement("br"));
    else if (node.kind === "code") {
      const code = document.createElement("code");
      code.textContent = node.value;
      container.append(code);
    } else if (node.kind === "link") {
      const link = document.createElement("a");
      link.href = node.href;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      if (node.title) link.title = node.title;
      appendInline(link, node.children);
      container.append(link);
    } else {
      const tag = node.kind === "strong" ? "strong" : node.kind === "emphasis" ? "em" : "del";
      const element = document.createElement(tag);
      appendInline(element, node.children);
      container.append(element);
    }
  }
}

function safeExternalHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function nestedTokens(token: Token): Token[] {
  return "tokens" in token && Array.isArray(token.tokens) ? token.tokens : [];
}

function safeLanguage(value?: string): string | undefined {
  return value?.trim().toLowerCase().match(/^[a-z0-9_+#.-]{1,30}$/u)?.[0];
}

function withoutThinking(text: string): string {
  return text
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<thinking\b[^>]*>[\s\S]*$/gi, "")
    .replace(/<\/?thinking\b[^>]*>/gi, "");
}
