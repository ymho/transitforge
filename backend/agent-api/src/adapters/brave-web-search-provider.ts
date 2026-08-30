import { availableExternalInformation, failedExternalInformation } from "@raiquora/trip/external-travel-information";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { WebSearchProvider, WebSearchQuery, WebSearchResult } from "@raiquora/trip/web-research";
import type { BraveSearchCredentialsRepository } from "../ports/brave-search-credentials.js";

interface FetchPort { fetch(input: string, init?: RequestInit): Promise<Response> }

export class BraveWebSearchProvider implements WebSearchProvider {
  constructor(
    private readonly http: FetchPort,
    private readonly credentials: BraveSearchCredentialsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: WebSearchQuery): Promise<ExternalTravelInformation<WebSearchResult>> {
    const text = query.query.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 300);
    if (!text) return failedExternalInformation({ code: "invalid_request", message: "Web検索語が必要です", retryable: false });
    const credentials = await this.credentials.load();
    if (!credentials) return failedExternalInformation({ code: "unauthorized", message: "Web検索の認証情報が設定されていません", retryable: false });
    const limit = Math.max(1, Math.min(8, Math.round(query.limit ?? 5)));
    try {
      const response = await this.http.fetch(searchUrl({ ...query, query: text }, limit), {
        headers: { Accept: "application/json", "X-Subscription-Token": credentials.apiKey },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return failedExternalInformation({
        code: response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 429 ? "rate_limited" : "unavailable",
        message: "Web検索を実行できません",
        retryable: response.status !== 401 && response.status !== 403,
      });
      const value: unknown = await response.json();
      const results = webResults(value).slice(0, limit);
      if (results.length === 0) return failedExternalInformation({ code: "invalid_request", message: "確認できるWeb情報が見つかりません", retryable: false });
      const retrievedAt = this.now();
      return availableExternalInformation({ query: text, results }, [{
        id: `web-search:brave:${encodeURIComponent(text)}:${retrievedAt.toISOString()}`,
        kind: "web",
        provider: "brave-search",
        sourceUrl: "https://search.brave.com/",
        retrievedAt: retrievedAt.toISOString(),
        validUntil: new Date(retrievedAt.getTime() + 60 * 60_000).toISOString(),
        attribution: "Brave Search",
        confidence: "observed",
      }], retrievedAt);
    } catch {
      return failedExternalInformation({ code: "unavailable", message: "Web検索を実行できません", retryable: true });
    }
  }
}

function searchUrl(query: WebSearchQuery, limit: number): string {
  const searchQuery = query.domains?.length
    ? `${query.query} ${query.domains.slice(0, 5).map((domain) => `site:${safeDomain(domain)}`).filter((item) => item !== "site:").join(" OR ")}`
    : query.query;
  const params = new URLSearchParams({ q: searchQuery, country: "JP", search_lang: "jp", ui_lang: "ja-JP", count: String(limit), safesearch: "moderate", extra_snippets: "true" });
  const freshness = query.freshness ? { day: "pd", week: "pw", month: "pm", year: "py" }[query.freshness] : undefined;
  if (freshness) params.set("freshness", freshness);
  return `https://api.search.brave.com/res/v1/web/search?${params}`;
}

function webResults(value: unknown): WebSearchResult["results"] {
  if (!isRecord(value) || !isRecord(value.web) || !Array.isArray(value.web.results)) return [];
  return value.web.results.flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    const url = safePublicHttpsUrl(raw.url);
    const title = clean(raw.title, 200);
    if (!url || !title) return [];
    const extraSnippets = Array.isArray(raw.extra_snippets)
      ? raw.extra_snippets.flatMap((item) => clean(item, 500) ? [clean(item, 500)] : []).slice(0, 5)
      : [];
    return [{
      id: `web-${index + 1}`,
      title,
      url,
      ...(clean(raw.description, 800) ? { description: clean(raw.description, 800) } : {}),
      ...(extraSnippets.length ? { extraSnippets } : {}),
      ...(clean(raw.page_age, 80) ? { publishedAt: clean(raw.page_age, 80) } : {}),
    }];
  });
}

function safeDomain(value: string): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/u.test(normalized) ? normalized : "";
}
function safePublicHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch { return undefined; }
}
function clean(value: unknown, limit: number): string {
  return typeof value === "string" ? value.normalize("NFKC").replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit) : "";
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
