import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { availableExternalInformation, failedExternalInformation } from "@raiquora/trip/external-travel-information";
import type { ExternalSourceEvidence, ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { WebPageDocument, WebPageReadQuery, WebPageReader, WebPageReadResult } from "@raiquora/trip/web-research";

interface FetchPort { fetch(input: string, init?: RequestInit): Promise<Response> }
interface AddressResolver { resolve(hostname: string): Promise<string[]> }

const MAX_URLS = 4;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 384 * 1024;
const MAX_TEXT_CHARS = 6_000;

export class SafeWebPageReader implements WebPageReader {
  constructor(
    private readonly http: FetchPort,
    private readonly resolver: AddressResolver = { resolve: resolveAddresses },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: WebPageReadQuery): Promise<ExternalTravelInformation<WebPageReadResult>> {
    const urls = [...new Set(query.urls)].slice(0, MAX_URLS);
    if (urls.length === 0) return failedExternalInformation({ code: "invalid_request", message: "読むページのURLが必要です", retryable: false });
    try {
      const pages = (await Promise.all(urls.map((url) => this.read(url).catch(() => undefined)))).flatMap((page) => page ? [page] : []);
      if (pages.length === 0) return failedExternalInformation({ code: "invalid_response", message: "安全に読めるWebページがありません", retryable: false });
      const retrievedAt = this.now();
      const evidence: ExternalSourceEvidence[] = pages.map((page, index) => ({
        id: `web-page:${index + 1}:${retrievedAt.toISOString()}`,
        kind: "web",
        provider: "web-page",
        sourceUrl: page.url,
        retrievedAt: retrievedAt.toISOString(),
        validUntil: new Date(retrievedAt.getTime() + 60 * 60_000).toISOString(),
        attribution: page.publisher ?? new URL(page.url).hostname,
        confidence: "observed",
      }));
      return availableExternalInformation({ pages }, evidence, retrievedAt);
    } catch {
      return failedExternalInformation({ code: "unavailable", message: "Webページを安全に取得できません", retryable: true });
    }
  }

  private async read(input: string): Promise<WebPageDocument | undefined> {
    let url = await this.safeUrl(input);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await this.http.fetch(url.toString(), {
        headers: { Accept: "text/html,text/plain;q=0.9", "User-Agent": "Raiquora/1.0" },
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) return undefined;
        url = await this.safeUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) return undefined;
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "text/html" && contentType !== "text/plain") return undefined;
      const body = await boundedText(response, MAX_RESPONSE_BYTES);
      const html = contentType === "text/html";
      const title = html ? extractTitle(body.text) : undefined;
      const text = (html ? htmlToText(body.text) : cleanText(body.text)).slice(0, MAX_TEXT_CHARS);
      if (!text) return undefined;
      return {
        url: url.toString(),
        ...(title ? { title } : {}),
        publisher: url.hostname,
        text,
        contentType: html ? "html" : "text",
        truncated: body.truncated || text.length >= MAX_TEXT_CHARS,
        untrustedExternalContent: true,
      };
    }
    return undefined;
  }

  private async safeUrl(value: string): Promise<URL> {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443") throw new Error("unsafe URL");
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("private host");
    const addresses = isIP(hostname) ? [hostname] : await this.resolver.resolve(hostname);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error("private address");
    url.hash = "";
    return url;
  }
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
}

function isPrivateAddress(value: string): boolean {
  const normalized = value.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
}

async function boundedText(response: Response, maximumBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maximumBytes - bytes;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }
    const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
    chunks.push(chunk);
    bytes += chunk.byteLength;
    if (value.byteLength > remaining) {
      truncated = true;
      await reader.cancel();
      break;
    }
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(combined), truncated };
}

function extractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  const title = match?.[1] ? cleanText(decodeEntities(match[1])).slice(0, 200) : "";
  return title || undefined;
}

function htmlToText(html: string): string {
  return cleanText(decodeEntities(html
    .replace(/<!--([\s\S]*?)-->/gu, " ")
    .replace(/<(?:script|style|noscript|template|svg|iframe)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg|iframe)>/giu, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")));
}

function cleanText(value: string): string {
  return value.normalize("NFKC").replace(/\r/gu, "").replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/giu, " ").replace(/&amp;/giu, "&").replace(/&lt;/giu, "<").replace(/&gt;/giu, ">").replace(/&quot;/giu, '"').replace(/&#39;/giu, "'")
    .replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}
