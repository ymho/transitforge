import { marked, type Token, type Tokens } from "marked";

/** Publish presentation syntax, never model-authored links, images or HTML.
 * Parse first so escaped punctuation and code are not reinterpreted as markup.
 * Verified source links are appended separately by the Evidence publisher. */
export function publicCommentaryMarkdown(value: string): string {
  return blocks(marked.lexer(value, { gfm: true, breaks: true })).trimEnd();
}

function blocks(tokens: Token[]): string {
  return tokens.map(token => {
    switch (token.type) {
      case "space": return "\n";
      case "paragraph": case "text": return inline(nested(token).length ? nested(token) : marked.Lexer.lexInline(token.text)) + "\n\n";
      case "heading": return `${"#".repeat(token.depth)} ${inline(nested(token))}\n\n`;
      case "list": {
        const list = token as Tokens.List;
        return list.items.map((item, index) => {
          const marker = list.ordered ? `${(list.start || 1) + index}. ` : "- ";
          return marker + blocks(item.tokens).trimEnd().replaceAll("\n", `\n${" ".repeat(marker.length)}`);
        }).join("\n") + "\n\n";
      }
      case "code": return token.raw + "\n\n";
      // Quotes, tables, raw HTML and reference definitions stay literal.
      default: return literal(token.raw) + "\n\n";
    }
  }).join("");
}

function inline(tokens: Token[]): string {
  return tokens.map(token => {
    switch (token.type) {
      case "text": return nested(token).length ? inline(nested(token)) : literal(token.text);
      case "escape": return literal(token.text);
      case "strong": return `**${inline(nested(token))}**`;
      case "em": return `*${inline(nested(token))}*`;
      case "del": return `~~${inline(nested(token))}~~`;
      case "codespan": return token.raw;
      case "br": return "\n";
      // Includes explicit links, autolinks, reference links, images and HTML.
      default: return literal(token.raw);
    }
  }).join("");
}
function nested(token: Token): Token[] {
  return "tokens" in token && Array.isArray(token.tokens) ? token.tokens : [];
}
function literal(value: string): string {
  return value.replace(/[\\`*_{}\[\]()#+.!|~<>&@:/=\-]/gu, "\\$&");
}
