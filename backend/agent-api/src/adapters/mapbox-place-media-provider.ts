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
import type { MapboxSearchCredentialsRepository } from "../ports/mapbox-search-credentials.js";
import { likelyOfficialWebsiteUrl } from "@raiquora/trip/official-website";

interface FetchPort {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

const SEARCH_ENDPOINT = "https://api.mapbox.com/search/searchbox/v1/forward";

export class MapboxPlaceMediaProvider implements PlaceMediaProvider {
  constructor(
    private readonly http: FetchPort,
    private readonly credentials: MapboxSearchCredentialsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: PlaceMediaQuery): Promise<ExternalTravelInformation<PlaceMediaSearchResult>> {
    const text = query.query.normalize("NFKC").trim().slice(0, 100);
    if (!text) {
      return failedExternalInformation({
        code: "invalid_request",
        message: "観光地の検索語が必要です",
        retryable: false,
      });
    }

    const credentials = await this.credentials.load();
    if (!credentials) {
      return failedExternalInformation({
        code: "unauthorized",
        message: "Mapbox Searchの認証情報が設定されていません",
        retryable: false,
      });
    }

    const limit = Math.max(1, Math.min(8, Math.round(query.limit ?? 5)));
    const places = new Map<string, PlaceMedia>();
    try {
      for (const searchText of placeSearchTerms(text, query.categories)) {
        const response = await this.http.fetch(
          mapboxSearchUrl(searchText, query, limit, credentials.accessToken),
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
        );
        if (!response.ok) {
          return failedExternalInformation({
            code: response.status === 401 || response.status === 403
              ? "unauthorized"
              : response.status === 429
                ? "rate_limited"
                : "unavailable",
            message: "観光地情報を取得できません",
            retryable: response.status !== 401 && response.status !== 403,
          });
        }
        const value: unknown = await response.json();
        for (const place of mapboxPlaces(value)) {
          if (!places.has(place.providerPlaceId)) places.set(place.providerPlaceId, place);
          if (places.size >= limit) break;
        }
        if (places.size >= limit) break;
      }

      if (places.size === 0) {
        return failedExternalInformation({
          code: "invalid_request",
          message: "確認できる観光地情報が見つかりません",
          retryable: false,
        });
      }
      const retrievedAt = this.now();
      return availableExternalInformation(
        { places: [...places.values()].slice(0, limit) },
        [{
          id: `place:mapbox:${encodeURIComponent(text)}:${retrievedAt.toISOString()}`,
          kind: "place",
          provider: "mapbox",
          sourceUrl: "https://www.mapbox.com/",
          retrievedAt: retrievedAt.toISOString(),
          validUntil: new Date(retrievedAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
          attribution: "© Mapbox",
          confidence: "observed",
        }],
        retrievedAt,
      );
    } catch {
      return failedExternalInformation({
        code: "unavailable",
        message: "観光地情報を取得できません",
        retryable: true,
      });
    }
  }
}

export function placeSearchTerms(query: string, categories: string[] = []): string[] {
  const normalized = `${query} ${categories.join(" ")}`.normalize("NFKC").trim();
  const terms = [query];
  if (/(?:酒蔵|酒造|蔵元|日本酒|醸造所)/u.test(normalized)) {
    const area = query
      .replace(/(?:酒蔵|酒造|蔵元|日本酒|醸造所)/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    const prefix = area ? `${area} ` : "";
    terms.push(`${prefix}酒蔵`, `${prefix}酒造`, `${prefix}日本酒 醸造所`);
  }
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))].slice(0, 4);
}

function mapboxSearchUrl(
  query: string,
  location: PlaceMediaQuery,
  limit: number,
  accessToken: string,
): string {
  const params = new URLSearchParams({
    q: query,
    access_token: accessToken,
    language: "ja",
    country: "JP",
    types: "poi",
    limit: String(limit),
  });
  if (finite(location.latitude) && finite(location.longitude)) {
    params.set("proximity", `${location.longitude},${location.latitude}`);
  }
  return `${SEARCH_ENDPOINT}?${params}`;
}

function mapboxPlaces(value: unknown): PlaceMedia[] {
  if (!isRecord(value) || !Array.isArray(value.features)) return [];
  return value.features.flatMap((raw): PlaceMedia[] => {
    if (!isRecord(raw) || !isRecord(raw.properties)) return [];
    const properties = raw.properties;
    if (properties.feature_type !== "poi") return [];
    const id = text(properties.mapbox_id);
    const name = text(properties.name_preferred) || text(properties.name);
    const coordinate = coordinates(properties, raw.geometry);
    if (!id || !name || !coordinate) return [];
    const metadata = isRecord(properties.metadata) ? properties.metadata : {};
    const website = likelyOfficialWebsiteUrl(metadata.website);
    const categories = stringArray(properties.poi_category);
    const openingHours = openingHoursText(metadata.open_hours);
    const reviewAverage = boundedRating(metadata.rating);
    const reviewCount = nonNegativeInteger(metadata.review_count);
    return [{
      providerPlaceId: id,
      name: name.slice(0, 120),
      ...(categories.length ? { categories } : {}),
      ...(text(properties.full_address) ? { address: text(properties.full_address).slice(0, 240) } : {}),
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      sourceUrl: "https://www.mapbox.com/",
      ...(website ? { officialWebsiteUrl: website } : {}),
      sources: [{ provider: "mapbox", label: "Mapbox", url: "https://www.mapbox.com/", role: "identity" }],
      ...(openingHours ? { openingHours, openingHoursStatus: "available" as const } : { openingHoursStatus: "unknown" as const }),
      ...(reviewAverage === undefined ? {} : { reviewAverage }),
      ...(reviewCount === undefined ? {} : { reviewCount }),
    }];
  });
}

function coordinates(
  properties: Record<string, unknown>,
  rawGeometry: unknown,
): { latitude: number; longitude: number } | undefined {
  const propertyCoordinates = isRecord(properties.coordinates) ? properties.coordinates : undefined;
  const latitude = propertyCoordinates && finite(propertyCoordinates.latitude)
    ? propertyCoordinates.latitude
    : undefined;
  const longitude = propertyCoordinates && finite(propertyCoordinates.longitude)
    ? propertyCoordinates.longitude
    : undefined;
  if (latitude !== undefined && longitude !== undefined) return { latitude, longitude };
  if (!isRecord(rawGeometry) || !Array.isArray(rawGeometry.coordinates)) return undefined;
  const [geometryLongitude, geometryLatitude] = rawGeometry.coordinates;
  return finite(geometryLatitude) && finite(geometryLongitude)
    ? { latitude: geometryLatitude, longitude: geometryLongitude }
    : undefined;
}

function openingHoursText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 240);
  if (!isRecord(value)) return undefined;
  const displayText = text(value.display_text) || text(value.text);
  return displayText ? displayText.slice(0, 240) : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []))].slice(0, 12)
    : [];
}

function boundedRating(value: unknown): number | undefined {
  return finite(value) && value >= 0 && value <= 5 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return finite(value) && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim() : "";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
