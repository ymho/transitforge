import { availableExternalInformation, failedExternalInformation, type ExternalTravelInformation } from "@raiquora/trip/external-travel-information";
import type { RestaurantCandidate, RestaurantProvider, RestaurantRequirements, RestaurantSearchQuery, RestaurantSearchResult } from "@raiquora/trip/restaurant-search";
import type { HotPepperCredentialsRepository } from "../ports/hot-pepper-credentials.js";

interface FetchPort { fetch(input: string, init?: RequestInit): Promise<Response> }
const endpoint = "https://webservice.recruit.co.jp/hotpepper/gourmet/v1/";
const requirementParameters: Record<keyof RestaurantRequirements, string> = {
  lunch: "lunch",
  lateNight: "midnight",
  childFriendly: "child",
  nonSmoking: "non_smoking",
  barrierFree: "barrier_free",
  parking: "parking",
  privateRoom: "private_room",
  cardAccepted: "card",
};

export class HotPepperRestaurantProvider implements RestaurantProvider {
  constructor(private readonly http: FetchPort, private readonly credentials: HotPepperCredentialsRepository, private readonly now: () => Date = () => new Date()) {}

  async search(query: RestaurantSearchQuery): Promise<ExternalTravelInformation<RestaurantSearchResult>> {
    const area = query.area.normalize("NFKC").trim().slice(0, 100);
    if (!area) return failedExternalInformation({ code: "invalid_request", message: "飲食店を探す地域が必要です", retryable: false });
    const credentials = await this.credentials.load();
    if (!credentials) return failedExternalInformation({ code: "unauthorized", message: "飲食店検索の認証情報が設定されていません", retryable: false });
    const limit = Math.max(1, Math.min(10, Math.round(query.limit ?? 5)));
    const hasCenter = finite(query.latitude) && finite(query.longitude);
    const keyword = hasCenter ? query.keyword?.trim() : [area, query.keyword].filter(Boolean).join(" ");
    const params = new URLSearchParams({ key: credentials.apiKey, format: "json", count: String(limit) });
    if (keyword) params.set("keyword", keyword.slice(0, 120));
    for (const [requirement, parameter] of Object.entries(requirementParameters)) {
      if (query.requirements?.[requirement as keyof RestaurantRequirements]) params.set(parameter, "1");
    }
    if (hasCenter) {
      params.set("lat", String(query.latitude)); params.set("lng", String(query.longitude)); params.set("range", String(query.range ?? 3)); params.set("datum", "world"); params.set("order", "4");
    }
    try {
      const response = await this.http.fetch(`${endpoint}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return failedExternalInformation({ code: response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "unauthorized" : "unavailable", message: "飲食店候補を取得できません", retryable: response.status !== 401 && response.status !== 403 });
      const value: unknown = await response.json();
      const providerFailure = hotPepperFailure(value);
      if (providerFailure) return failedExternalInformation(providerFailure);
      const restaurants = restaurantCandidates(value).slice(0, limit);
      const retrievedAt = this.now();
      return availableExternalInformation({ area, restaurants }, [{ id: `restaurant:hot-pepper:${encodeURIComponent(area)}:${retrievedAt.toISOString()}`, kind: "restaurant", provider: "hot-pepper", sourceUrl: "https://webservice.recruit.co.jp/doc/hotpepper/reference.html", retrievedAt: retrievedAt.toISOString(), validUntil: new Date(retrievedAt.getTime() + 30 * 60_000).toISOString(), attribution: "ホットペッパーグルメ Webサービス", confidence: "observed" }], retrievedAt);
    } catch {
      return failedExternalInformation({ code: "unavailable", message: "飲食店候補を取得できません", retryable: true });
    }
  }
}

function restaurantCandidates(value: unknown): RestaurantCandidate[] {
  if (!isRecord(value) || !isRecord(value.results) || !Array.isArray(value.results.shop)) return [];
  return value.results.shop.flatMap((shop) => {
    if (!isRecord(shop) || !text(shop.id) || !text(shop.name) || !isRecord(shop.urls) || !text(shop.urls.pc)) return [];
    const photo = isRecord(shop.photo) && isRecord(shop.photo.pc) ? text(shop.photo.pc.l) || text(shop.photo.pc.m) : "";
    const budget = isRecord(shop.budget) ? shop.budget : undefined;
    const features = positiveFeatures(shop);
    return [{ providerRestaurantId: text(shop.id), name: text(shop.name).slice(0, 120), ...(text(shop.address) ? { address: text(shop.address).slice(0, 240) } : {}), ...(finite(shop.lat) ? { latitude: shop.lat } : {}), ...(finite(shop.lng) ? { longitude: shop.lng } : {}), ...(isRecord(shop.genre) && text(shop.genre.name) ? { genre: text(shop.genre.name).slice(0, 80) } : {}), ...(budget && text(budget.name) ? { budget: text(budget.name).slice(0, 100) } : {}), ...(budget && text(budget.average) ? { averageBudget: text(budget.average).slice(0, 120) } : {}), ...(text(shop.open) ? { openingHours: text(shop.open).slice(0, 240) } : {}), ...(text(shop.close) ? { regularHoliday: text(shop.close).slice(0, 160) } : {}), ...(text(shop.station_name) ? { stationName: text(shop.station_name).slice(0, 100) } : {}), ...(text(shop.access) ? { access: text(shop.access).slice(0, 240) } : {}), ...(features.length ? { features } : {}), ...(photo ? { imageUrl: photo } : {}), detailUrl: text(shop.urls.pc) }];
  });
}

function hotPepperFailure(value: unknown): { code: "unauthorized" | "invalid_request" | "unavailable"; message: string; retryable: boolean } | undefined {
  if (!isRecord(value) || !isRecord(value.results)) return { code: "unavailable", message: "飲食店検索の応答形式が不正です", retryable: true };
  const raw = Array.isArray(value.results.error) ? value.results.error[0] : value.results.error;
  if (raw === undefined) return undefined;
  const error = isRecord(raw) ? raw : {};
  const providerCode = text(error.code);
  const code = providerCode === "2000" ? "unauthorized" : providerCode === "3000" ? "invalid_request" : "unavailable";
  return { code, message: text(error.message) || "飲食店候補を取得できません", retryable: code === "unavailable" };
}

function positiveFeatures(shop: Record<string, unknown>): string[] {
  const candidates: Array<[string, unknown, RegExp]> = [
    ["ランチ", shop.lunch, /あり/u],
    ["23時以降営業", shop.midnight, /営業/u],
    ["子ども連れ", shop.child, /歓迎|OK|可/u],
    ["禁煙席", shop.non_smoking, /禁煙/u],
    ["バリアフリー", shop.barrier_free, /あり|対応/u],
    ["駐車場", shop.parking, /あり|完備/u],
    ["個室", shop.private_room, /あり/u],
    ["カード可", shop.card, /利用可|可/u],
  ];
  return candidates.flatMap(([label, value, pattern]) => pattern.test(text(value)) ? [label] : []).slice(0, 8);
}
function text(value: unknown): string { return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim() : ""; }
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
