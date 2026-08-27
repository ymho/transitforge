import {
  availableExternalInformation,
  failedExternalInformation,
} from "@raiquora/trip/external-travel-information";
import type { ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type {
  PlaceMedia,
  PlaceMediaProvider,
  PlaceMediaQuery,
  PlaceMediaSearchResult,
} from "@raiquora/trip/place-media";

interface FetchPort { fetch(input: string, init?: RequestInit): Promise<Response> }

export class WikipediaPlaceMediaProvider implements PlaceMediaProvider {
  constructor(private readonly http: FetchPort, private readonly now: () => Date = () => new Date()) {}

  async search(query: PlaceMediaQuery): Promise<ExternalTravelInformation<PlaceMediaSearchResult>> {
    const text = query.query.normalize("NFKC").trim().slice(0, 100);
    if (!text) return failedExternalInformation({ code: "invalid_request", message: "観光地の検索語が必要です", retryable: false });
    try {
      const limit = Math.max(1, Math.min(8, Math.round(query.limit ?? 5)));
      const searchUrl = wikipediaSearchUrl(text, query, limit);
      const response = await this.http.fetch(searchUrl, { headers: { Accept: "application/json", "Api-User-Agent": "Raiquora/1.0" } });
      if (!response.ok) return failedExternalInformation({ code: response.status === 429 ? "rate_limited" : "unavailable", message: "観光地情報を取得できません", retryable: true });
      const value: unknown = await response.json();
      const pages = wikipediaPages(value).slice(0, limit);
      if (pages.length === 0) return failedExternalInformation({ code: "invalid_request", message: "確認できる観光地情報が見つかりません", retryable: false });
      const imageMetadata = await this.imageMetadata(pages.flatMap((page) => page.pageImage ? [page.pageImage] : []));
      const places = pages.map((page): PlaceMedia => ({
        providerPlaceId: String(page.pageId),
        name: page.title,
        ...(page.extract ? { summary: page.extract.slice(0, 400) } : {}),
        ...(page.latitude === undefined ? {} : { latitude: page.latitude }),
        ...(page.longitude === undefined ? {} : { longitude: page.longitude }),
        sourceUrl: page.fullUrl,
        openingHoursStatus: "unknown",
        ...(page.pageImage && imageMetadata.get(page.pageImage)
          ? { image: imageMetadata.get(page.pageImage)! }
          : page.thumbnail ? { image: { url: page.thumbnail.url, width: page.thumbnail.width, height: page.thumbnail.height, attribution: "Wikipedia contributors / Wikimedia Commons", hotlinkAllowed: true } } : {}),
      }));
      const retrievedAt = this.now();
      return availableExternalInformation({ places }, [{
        id: `place:wikipedia:${encodeURIComponent(text)}:${retrievedAt.toISOString()}`,
        kind: "place",
        provider: "wikipedia",
        sourceUrl: searchUrl,
        retrievedAt: retrievedAt.toISOString(),
        validUntil: new Date(retrievedAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
        attribution: "Wikipedia contributors / Wikimedia Commons",
        confidence: "observed",
      }], retrievedAt);
    } catch {
      return failedExternalInformation({ code: "unavailable", message: "観光地情報を取得できません", retryable: true });
    }
  }

  private async imageMetadata(fileNames: string[]): Promise<Map<string, NonNullable<PlaceMedia["image"]>>> {
    const unique = [...new Set(fileNames)].slice(0, 8);
    if (unique.length === 0) return new Map();
    const params = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", origin: "*",
      prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "640",
      titles: unique.map((name) => `File:${name}`).join("|"),
    });
    const response = await this.http.fetch(`https://ja.wikipedia.org/w/api.php?${params}`, { headers: { Accept: "application/json", "Api-User-Agent": "Raiquora/1.0" } });
    if (!response.ok) return new Map();
    const value: unknown = await response.json();
    if (!isRecord(value) || !isRecord(value.query) || !Array.isArray(value.query.pages)) return new Map();
    const result = new Map<string, NonNullable<PlaceMedia["image"]>>();
    for (const raw of value.query.pages) {
      if (!isRecord(raw) || typeof raw.title !== "string" || !Array.isArray(raw.imageinfo) || !isRecord(raw.imageinfo[0])) continue;
      const info = raw.imageinfo[0];
      const url = typeof info.thumburl === "string" ? info.thumburl : typeof info.url === "string" ? info.url : undefined;
      if (!url) continue;
      const metadata = isRecord(info.extmetadata) ? info.extmetadata : {};
      const creator = metadataValue(metadata.Artist);
      const license = metadataValue(metadata.LicenseShortName);
      const credit = metadataValue(metadata.Credit);
      result.set(raw.title.replace(/^File:/u, ""), {
        url,
        ...(number(info.thumbwidth) ? { width: info.thumbwidth } : {}),
        ...(number(info.thumbheight) ? { height: info.thumbheight } : {}),
        ...(creator ? { creator: stripHtml(creator) } : {}),
        ...(license ? { license: stripHtml(license) } : {}),
        attribution: [credit, creator, license].flatMap((item) => item ? [stripHtml(item)] : []).join(" / ") || "Wikimedia Commons",
        hotlinkAllowed: true,
        ...(typeof info.descriptionurl === "string" ? { descriptionUrl: info.descriptionurl } : {}),
      });
    }
    return result;
  }
}

interface WikipediaPage { pageId: number; title: string; fullUrl: string; extract?: string; latitude?: number; longitude?: number; pageImage?: string; thumbnail?: { url: string; width?: number; height?: number } }

function wikipediaSearchUrl(query: string, location: PlaceMediaQuery, limit: number): string {
  const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", origin: "*", prop: "coordinates|pageimages|extracts|info", inprop: "url", exintro: "1", explaintext: "1", piprop: "thumbnail|name", pithumbsize: "640" });
  if (number(location.latitude) && number(location.longitude)) {
    params.set("generator", "geosearch"); params.set("ggscoord", `${location.latitude}|${location.longitude}`);
    params.set("ggsradius", String(Math.max(100, Math.min(10_000, Math.round(location.radiusMeters ?? 5_000))))); params.set("ggslimit", String(limit));
  } else {
    params.set("generator", "search"); params.set("gsrsearch", `${query} 観光`); params.set("gsrnamespace", "0"); params.set("gsrlimit", String(limit));
  }
  return `https://ja.wikipedia.org/w/api.php?${params}`;
}

function wikipediaPages(value: unknown): WikipediaPage[] {
  if (!isRecord(value) || !isRecord(value.query) || !Array.isArray(value.query.pages)) return [];
  return value.query.pages.flatMap((raw) => {
    if (!isRecord(raw) || !number(raw.pageid) || typeof raw.title !== "string" || typeof raw.fullurl !== "string") return [];
    const coordinate = Array.isArray(raw.coordinates) && isRecord(raw.coordinates[0]) ? raw.coordinates[0] : undefined;
    const thumbnail = isRecord(raw.thumbnail) && typeof raw.thumbnail.source === "string" ? { url: raw.thumbnail.source, ...(number(raw.thumbnail.width) ? { width: raw.thumbnail.width } : {}), ...(number(raw.thumbnail.height) ? { height: raw.thumbnail.height } : {}) } : undefined;
    return [{ pageId: raw.pageid, title: raw.title.slice(0, 120), fullUrl: raw.fullurl, ...(typeof raw.extract === "string" ? { extract: raw.extract } : {}), ...(coordinate && number(coordinate.lat) ? { latitude: coordinate.lat } : {}), ...(coordinate && number(coordinate.lon) ? { longitude: coordinate.lon } : {}), ...(typeof raw.pageimage === "string" ? { pageImage: raw.pageimage } : {}), ...(thumbnail ? { thumbnail } : {}) }];
  });
}

function metadataValue(value: unknown): string | undefined { return isRecord(value) && typeof value.value === "string" ? value.value : undefined; }
function stripHtml(value: string): string { return value.replace(/<[^>]+>/gu, " ").replace(/&[^;]+;/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 240); }
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
