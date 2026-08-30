import type { AgentOperation } from "../ports/agent-operation.js";
import type { WebPageReader, WebSearchProvider } from "../ports/web-research.js";

export function createWebSearchOperation(provider: WebSearchProvider): AgentOperation {
  return async (request) => {
    const query = text(request.query, 300);
    if (!query) return { statusCode: 400, body: { message: "Web検索条件が不正です" } };
    const freshness = ["day", "week", "month", "year"].includes(String(request.freshness))
      ? request.freshness as "day" | "week" | "month" | "year"
      : undefined;
    const domains = Array.isArray(request.domains)
      ? request.domains.flatMap((domain) => text(domain, 120) ? [text(domain, 120)] : []).slice(0, 5)
      : undefined;
    const result = await provider.search({ query, ...(freshness ? { freshness } : {}), ...(domains?.length ? { domains } : {}), ...(finite(request.limit) ? { limit: request.limit } : {}) });
    return { body: { webSearch: result } };
  };
}

export function createWebPageReadOperation(reader: WebPageReader): AgentOperation {
  return async (request) => {
    if (!Array.isArray(request.urls)) return { statusCode: 400, body: { message: "WebページのURLが不正です" } };
    const urls = request.urls.flatMap((url) => text(url, 2_000) ? [text(url, 2_000)] : []).slice(0, 4);
    if (urls.length === 0) return { statusCode: 400, body: { message: "WebページのURLが不正です" } };
    const result = await reader.search({ urls });
    return { body: { webPages: result } };
  };
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, limit) : "";
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
