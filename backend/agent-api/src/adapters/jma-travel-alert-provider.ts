import {
  availableExternalInformation,
  failedExternalInformation,
  type ExternalTravelInformation,
} from "@raiquora/trip/external-travel-information";
import type {
  TravelAlert,
  TravelAlertCategory,
  TravelAlertProvider,
  TravelAlertQuery,
  TravelAlertSearchResult,
} from "@raiquora/trip/travel-alert";

interface FetchPort {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

const feedUrls = [
  "https://www.data.jma.go.jp/developer/xml/feed/extra.xml",
  "https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml",
] as const;
const maximumFeedBytes = 768 * 1_024;

export class JmaTravelAlertProvider implements TravelAlertProvider {
  private cached?: { expiresAt: number; entries: TravelAlert[]; evidenceRetrievedAt: string };

  constructor(
    private readonly http: FetchPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: TravelAlertQuery): Promise<ExternalTravelInformation<TravelAlertSearchResult>> {
    const area = normalizedText(query.area).slice(0, 80);
    if (!area) {
      return failedExternalInformation({ code: "invalid_request", message: "防災情報を確認する地域が必要です", retryable: false });
    }
    const limit = Math.max(1, Math.min(12, Math.round(query.limit ?? 8)));
    const categories = new Set(query.categories ?? []);
    try {
      const snapshot = await this.entries();
      const areaTerms = areaSearchTerms(area);
      const alerts = snapshot.entries.filter((entry) =>
        (categories.size === 0 || categories.has(entry.category)) &&
        areaTerms.some((term) => normalizedText(`${entry.title} ${entry.summary} ${entry.issuer ?? ""}`).includes(term)))
        .slice(0, limit);
      const retrievedAt = new Date(snapshot.evidenceRetrievedAt);
      return availableExternalInformation({ area, alerts }, feedUrls.map((sourceUrl, index) => ({
        id: `safety-alert:jma:${index}:${snapshot.evidenceRetrievedAt}`,
        kind: "safety-alert" as const,
        provider: "jma",
        sourceUrl,
        retrievedAt: snapshot.evidenceRetrievedAt,
        validUntil: new Date(retrievedAt.getTime() + 5 * 60_000).toISOString(),
        attribution: "気象庁防災情報XML",
        confidence: "observed" as const,
      })), retrievedAt);
    } catch {
      return failedExternalInformation({ code: "unavailable", message: "気象庁の防災情報を取得できません", retryable: true });
    }
  }

  private async entries(): Promise<{ entries: TravelAlert[]; evidenceRetrievedAt: string }> {
    const now = this.now();
    if (this.cached && this.cached.expiresAt > now.getTime()) return this.cached;
    const responses = await Promise.all(feedUrls.map((url) => this.http.fetch(url, {
      headers: { Accept: "application/atom+xml, application/xml;q=0.9" },
      signal: AbortSignal.timeout(8_000),
    })));
    const entries: TravelAlert[] = [];
    for (const response of responses) {
      if (!response.ok) throw new Error("JMA feed unavailable");
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > maximumFeedBytes) throw new Error("JMA feed too large");
      const xml = await response.text();
      if (Buffer.byteLength(xml, "utf8") > maximumFeedBytes) throw new Error("JMA feed too large");
      entries.push(...parseJmaAtomFeed(xml));
    }
    const unique = [...new Map(entries.map((entry) => [entry.providerAlertId, entry])).values()]
      .sort((left, right) => Date.parse(right.issuedAt) - Date.parse(left.issuedAt))
      .slice(0, 240);
    this.cached = {
      entries: unique,
      evidenceRetrievedAt: now.toISOString(),
      expiresAt: now.getTime() + 60_000,
    };
    return this.cached;
  }
}

export function parseJmaAtomFeed(xml: string): TravelAlert[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gu)].flatMap((match) => {
    const entry = match[1] ?? "";
    const title = xmlElement(entry, "title");
    const id = xmlElement(entry, "id");
    const issuedAt = xmlElement(entry, "updated");
    const summary = xmlElement(entry, "content");
    const issuer = xmlElement(entry, "name");
    const sourceUrl = xmlAttribute(entry, "link", "href") ?? id;
    if (!title || !id || !issuedAt || !summary || !sourceUrl || !Number.isFinite(Date.parse(issuedAt))) return [];
    return [{
      providerAlertId: id.slice(0, 300),
      category: alertCategory(title),
      severity: alertSeverity(summary),
      title: title.slice(0, 160),
      summary: summary.slice(0, 600),
      issuedAt,
      ...(issuer ? { issuer: issuer.slice(0, 120) } : {}),
      sourceUrl: sourceUrl.slice(0, 500),
    }];
  });
}

function alertCategory(value: string): TravelAlertCategory {
  if (/津波/u.test(value)) return "tsunami";
  if (/地震|震源|震度/u.test(value)) return "earthquake";
  if (/火山|噴火/u.test(value)) return "volcano";
  if (/台風/u.test(value)) return "typhoon";
  if (/警報|注意報/u.test(value)) return "warning";
  if (/気象情報|気象解説/u.test(value)) return "weather-information";
  return "other";
}

function alertSeverity(value: string): TravelAlert["severity"] {
  if (/大津波警報|特別警報|噴火警報.*居住地域/u.test(value)) return "emergency";
  if (/警報|厳重に警戒/u.test(value)) return "warning";
  if (/注意報|注意・警戒|十分注意/u.test(value)) return "advisory";
  if (/情報|解説/u.test(value)) return "information";
  return "unknown";
}

function areaSearchTerms(value: string): string[] {
  const normalized = normalizedText(value);
  const shortened = normalized.replace(/[都道府県]$/u, "");
  return [...new Set([normalized, shortened])].filter((term) => term.length >= 2);
}

function xmlElement(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "u"));
  return match ? decodedXml(match[1] ?? "") : "";
}

function xmlAttribute(xml: string, element: string, attribute: string): string | undefined {
  const match = xml.match(new RegExp(`<${element}\\b[^>]*\\b${attribute}="([^"]+)"[^>]*/?>`, "u"));
  return match ? decodedXml(match[1] ?? "") : undefined;
}

function decodedXml(value: string): string {
  return normalizedText(value
    .replace(/^<!\[CDATA\[/u, "")
    .replace(/\]\]>$/u, "")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&amp;/gu, "&"));
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}
