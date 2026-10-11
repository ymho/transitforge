import type { MapboxSearchCredentialsRepository } from "../ports/mapbox-search-credentials.js";
import type { ServiceAreaLocation, ServiceAreaLookup } from "../ports/service-area-lookup.js";
import { normalizePrefecture } from "@raiquora/trip/service-area";

/** One request-scoped cache and bounded calls; unavailable/ambiguous geography fails closed. */
export class MapboxServiceAreaLookup implements ServiceAreaLookup {
  private readonly cache = new Map<string, Promise<ServiceAreaLocation | undefined>>();
  constructor(private readonly http: { fetch(url: string, init?: RequestInit): Promise<Response> },
    private readonly credentials: MapboxSearchCredentialsRepository) {}
  resolve(input: { query?: string; latitude?: number; longitude?: number }): Promise<ServiceAreaLocation | undefined> {
    const query = input.query?.normalize("NFKC").trim().slice(0, 100);
    const hasPoint = Number.isFinite(input.latitude) && Number.isFinite(input.longitude);
    if (!hasPoint && !query || hasPoint && (Math.abs(input.latitude!) > 90 || Math.abs(input.longitude!) > 180)) return Promise.resolve(undefined);
    const key = hasPoint ? `${input.longitude},${input.latitude}` : query!;
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.cache.size >= 24) return Promise.resolve(undefined);
    const loaded = this.load(input, query, hasPoint); this.cache.set(key, loaded); return loaded;
  }
  private async load(input: { latitude?: number; longitude?: number }, query: string | undefined, hasPoint: boolean) {
    try {
      const credentials = await this.credentials.load(); if (!credentials) return;
      const params = new URLSearchParams({ access_token: credentials.accessToken, language: "ja", limit: "3" });
      // Do not force country=JP: a foreign place must be classified as foreign, not matched to a Japanese namesake.
      if (hasPoint) { params.set("latitude", String(input.latitude)); params.set("longitude", String(input.longitude)); }
      else params.set("q", query!);
      const response = await this.http.fetch(`https://api.mapbox.com/search/searchbox/v1/${hasPoint ? "reverse" : "forward"}?${params}`,
        { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4_000) });
      if (!response.ok) return;
      const data: unknown = await response.json(); if (!record(data) || !Array.isArray(data.features) || !data.features.length) return;
      const locations = data.features.map(feature => {
        const properties = record(feature) && record(feature.properties) ? feature.properties : undefined;
        const context = properties && record(properties.context) ? properties.context : undefined;
        if (!context || !record(context.country)) return;
        const country = typeof context.country.country_code === "string" ? context.country.country_code.toUpperCase() : undefined;
        if (!country) return;
        if (country !== "JP") return { country, prefecture: "" };
        const region = record(context.region) ? context.region : properties?.feature_type === "region" ? properties : undefined;
        const prefecture = normalizePrefecture(region?.region_code_full) ?? normalizePrefecture(region?.name);
        return prefecture ? { country, prefecture } : undefined;
      });
      if (locations.some(location => !location) || new Set(locations.map(location => `${location!.country}:${location!.prefecture}`)).size !== 1) return;
      return locations[0];
    } catch { return; }
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
