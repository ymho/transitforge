import {
  availableExternalInformation,
  failedExternalInformation,
  type ExternalTravelInformation,
} from "@raiquora/trip/external-travel-information";
import type {
  HazardAlert,
  HazardAlertCategory,
  HazardAlertProvider,
  HazardAlertQuery,
  HazardAlertSearchResult,
} from "@raiquora/trip/hazard-alert";
import { hazardAlertBounds, parseHazardAlertQuery, validateHazardAlert, validateHazardAlertInformation } from "@raiquora/trip/hazard-alert";

interface FetchPort {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

const feedUrls = [
  "https://www.data.jma.go.jp/developer/xml/feed/extra.xml",
  "https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml",
] as const;
const maximumFeedBytes = 768 * 1_024;
class InvalidJmaFeed extends Error {}

export class JmaHazardAlertProvider implements HazardAlertProvider {
  private cached?: { expiresAt: number; entries: HazardAlert[]; evidenceRetrievedAt: string };

  constructor(
    private readonly http: FetchPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: HazardAlertQuery): Promise<ExternalTravelInformation<HazardAlertSearchResult>> {
    try { query = parseHazardAlertQuery(query); }
    catch {
      return failedExternalInformation({ code: "invalid_request", message: "防災情報を確認する地域が必要です", retryable: false });
    }
    const { area } = query;
    const limit = query.limit ?? 8;
    const categories = new Set(query.categories ?? []);
    try {
      const snapshot = await this.entries();
      const areaTerms = areaSearchTerms(area);
      const alerts = snapshot.entries.filter((entry) =>
        (categories.size === 0 || categories.has(entry.category)) &&
        areaTerms.some((term) => normalizedText(`${entry.title} ${entry.summary} ${entry.issuer ?? ""}`).includes(term)))
        .slice(0, limit);
      const retrievedAt = new Date(snapshot.evidenceRetrievedAt);
      const information = availableExternalInformation({ area, alerts }, feedUrls.map((sourceUrl, index) => ({
        id: `safety-alert:jma:${index}:${snapshot.evidenceRetrievedAt}`,
        kind: "safety-alert" as const,
        provider: "jma",
        sourceUrl,
        retrievedAt: snapshot.evidenceRetrievedAt,
        validUntil: new Date(retrievedAt.getTime() + 5 * 60_000).toISOString(),
        attribution: "気象庁防災情報XML",
        confidence: "observed" as const,
      })), this.now());
      validateHazardAlertInformation(information);
      return information;
    } catch (error) {
      if (error instanceof InvalidJmaFeed) return failedExternalInformation({ code: "invalid_response", message: "気象庁の防災情報を確認できません", retryable: true });
      return failedExternalInformation({ code: "unavailable", message: "気象庁の防災情報を取得できません", retryable: true });
    }
  }

  private async entries(): Promise<{ entries: HazardAlert[]; evidenceRetrievedAt: string }> {
    const now = this.now();
    if (this.cached && this.cached.expiresAt > now.getTime()) return this.cached;
    const responses = await Promise.all(feedUrls.map((url) => this.http.fetch(url, {
      headers: { Accept: "application/atom+xml, application/xml;q=0.9" },
      signal: AbortSignal.timeout(8_000),
    })));
    const entries: HazardAlert[] = [];
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

export function parseJmaAtomFeed(xml: string): HazardAlert[] {
  // This bounded Atom reader supports the existing JMA feed subset, not arbitrary XML.
  // A broken/unsupported response is unavailable, never a successful empty alert set.
  if (Buffer.byteLength(xml, "utf8") > maximumFeedBytes || /<!DOCTYPE|<!ENTITY/iu.test(xml) ||
      !/^\s*(?:<\?xml[^?]*\?>\s*)?<feed\b[^>]*>[\s\S]*<\/feed>\s*$/u.test(xml)) throw new InvalidJmaFeed();
  validateAtomStructure(xml);
  const matches = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gu)];
  if (matches.length !== [...xml.matchAll(/<entry\b/gu)].length || matches.length !== [...xml.matchAll(/<\/entry>/gu)].length) throw new InvalidJmaFeed();
  return matches.map((match) => {
    const entry = match[1] ?? "";
    const title = xmlElement(entry, "title");
    const id = xmlElement(entry, "id", false);
    const issuedAt = xmlElement(entry, "updated");
    const summary = xmlElement(entry, "content");
    const issuer = xmlElement(entry, "name");
    const sourceUrl = xmlAttribute(entry, "link", "href") ?? id;
    const alert: HazardAlert = {
      // IDs and URLs are not truncated/normalized into a different identity.
      providerAlertId: id,
      category: alertCategory(title),
      severity: alertSeverity(summary),
      title: title.slice(0, hazardAlertBounds.title),
      summary: summary.slice(0, hazardAlertBounds.summary),
      issuedAt,
      ...(issuer ? { issuer: issuer.slice(0, hazardAlertBounds.issuer) } : {}),
      sourceUrl,
    };
    try { validateHazardAlert(alert); }
    catch { throw new InvalidJmaFeed(); }
    return alert;
  });
}

/** Structural guard for the supported feed subset, with no entity expansion or network IO. */
function validateAtomStructure(xml: string): void {
  const stack: string[] = [];
  let cursor = 0;
  for (const match of xml.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^<>"']|"[^"]*"|'[^']*')*>/gu)) {
    if (xml.slice(cursor, match.index).includes("<")) throw new InvalidJmaFeed();
    const tag = match[0]; cursor = match.index + tag.length;
    if (tag.startsWith("<!--") || tag.startsWith("<![CDATA[") || tag.startsWith("<?")) continue;
    const name = tag.match(/^<\/?([A-Za-z_][\w:.-]*)(?:\s|\/?>)/u)?.[1];
    if (!name) throw new InvalidJmaFeed();
    if (tag.startsWith("</")) {
      if (tag !== `</${name}>` || stack.pop() !== name) throw new InvalidJmaFeed();
    } else if (!tag.endsWith("/>")) stack.push(name);
  }
  if (stack.length || xml.slice(cursor).includes("<")) throw new InvalidJmaFeed();
}

function alertCategory(value: string): HazardAlertCategory {
  if (/津波/u.test(value)) return "tsunami";
  if (/地震|震源|震度/u.test(value)) return "earthquake";
  if (/火山|噴火/u.test(value)) return "volcano";
  if (/台風/u.test(value)) return "typhoon";
  if (/警報|注意報/u.test(value)) return "warning";
  if (/気象情報|気象解説/u.test(value)) return "weather-information";
  return "other";
}

function alertSeverity(value: string): HazardAlert["severity"] {
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

function xmlElement(xml: string, name: string, normalize = true): string {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "u"));
  return match ? decodedXml(match[1] ?? "", normalize) : "";
}

function xmlAttribute(xml: string, element: string, attribute: string): string | undefined {
  const match = xml.match(new RegExp(`<${element}\\b[^>]*\\b${attribute}="([^"]+)"[^>]*/?>`, "u"));
  return match ? decodedXml(match[1] ?? "", false) : undefined;
}

function decodedXml(value: string, normalize = true): string {
  const decoded = value
    .replace(/^<!\[CDATA\[/u, "")
    .replace(/\]\]>$/u, "")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
  return normalize ? normalizedText(decoded) : decoded.trim();
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}
