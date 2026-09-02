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
import type { BraveSearchCredentialsRepository } from "../ports/brave-search-credentials.js";

interface FetchPort {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

interface WebImage {
  imageUrl: string;
  sourcePageUrl: string;
  attribution: string;
  width?: number;
  height?: number;
}

const SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/images/search";

export class BraveImagePlaceMediaProvider implements PlaceMediaProvider {
  constructor(
    private readonly http: FetchPort,
    private readonly credentials: BraveSearchCredentialsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: PlaceMediaQuery): Promise<ExternalTravelInformation<PlaceMediaSearchResult>> {
    const text = query.query.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 300);
    if (!text) {
      return failedExternalInformation({
        code: "invalid_request",
        message: "画像の検索語が必要です",
        retryable: false,
      });
    }
    const credentials = await this.credentials.load();
    if (!credentials) {
      return failedExternalInformation({
        code: "unauthorized",
        message: "画像検索の認証情報が設定されていません",
        retryable: false,
      });
    }

    try {
      const response = await this.http.fetch(imageSearchUrl(text), {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": credentials.apiKey,
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        return failedExternalInformation({
          code: response.status === 401 || response.status === 403
            ? "unauthorized"
            : response.status === 429
              ? "rate_limited"
              : "unavailable",
          message: "観光写真を取得できません",
          retryable: response.status !== 401 && response.status !== 403,
        });
      }
      const images = webImages(await response.json()).slice(0, 8);
      if (images.length === 0) {
        return failedExternalInformation({
          code: "invalid_request",
          message: "表示できる観光写真が見つかりません",
          retryable: false,
        });
      }
      const retrievedAt = this.now();
      const place: PlaceMedia = {
        providerPlaceId: `brave-image:${stableQueryHash(text)}`,
        name: text,
        sourceUrl: images[0]!.sourcePageUrl,
        sources: [{
          provider: "brave-image-search",
          label: images[0]!.attribution,
          url: images[0]!.sourcePageUrl,
          role: "discovery",
        }],
        openingHoursStatus: "unknown",
        image: toPlaceImage(images[0]!),
        images: images.map(toPlaceImage),
      };
      return availableExternalInformation({ places: [place] }, [{
        id: `image-search:brave:${stableQueryHash(text)}:${retrievedAt.toISOString()}`,
        kind: "media",
        provider: "brave-image-search",
        sourceUrl: "https://search.brave.com/",
        retrievedAt: retrievedAt.toISOString(),
        validUntil: new Date(retrievedAt.getTime() + 60 * 60_000).toISOString(),
        attribution: "Brave Search",
        confidence: "observed",
      }], retrievedAt);
    } catch {
      return failedExternalInformation({
        code: "unavailable",
        message: "観光写真を取得できません",
        retryable: true,
      });
    }
  }
}

function imageSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    country: "JP",
    search_lang: "ja",
    count: "8",
    safesearch: "strict",
  });
  return `${SEARCH_ENDPOINT}?${params}`;
}

function webImages(value: unknown): WebImage[] {
  if (!isRecord(value) || !Array.isArray(value.results)) return [];
  return value.results.flatMap((raw): WebImage[] => {
    if (!isRecord(raw) || !isRecord(raw.thumbnail)) return [];
    const imageUrl = safePublicHttpsUrl(raw.thumbnail.src);
    const sourcePageUrl = safePublicHttpsUrl(raw.url);
    if (!imageUrl || !sourcePageUrl) return [];
    const source = clean(raw.source, 160) || new URL(sourcePageUrl).hostname;
    const width = positiveInteger(raw.thumbnail.width);
    const height = positiveInteger(raw.thumbnail.height);
    return [{
      imageUrl,
      sourcePageUrl,
      attribution: source,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    }];
  });
}

function toPlaceImage(image: WebImage): NonNullable<PlaceMedia["image"]> {
  return {
    url: image.imageUrl,
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height }),
    attribution: image.attribution,
    descriptionUrl: image.sourcePageUrl,
    hotlinkAllowed: true,
  };
}

function safePublicHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function clean(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit)
    : "";
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function stableQueryHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
